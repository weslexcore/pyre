// The suggestion worker: QStash calls this for every job lib/suggestions/
// dispatch publishes (a classification that found an action, an admin's
// AI button) and retries it with backoff on any non-2xx. It files or
// picks up the run and starts the pyre-agents suggester on it; the agent's
// work then happens there, and ends with it posting to /api/agent/suggestions.
//
//   POST { sourceType, sourceId, trigger, runId? } → 200 { state } | 200 { skipped }
//                                   503 when the agents app could not be reached
//
// Auth: Bearer CRON_SECRET, forwarded by QStash (same as the cron tick).

import type { APIRoute } from 'astro';
import { isCronAuthorized, unauthorizedResponse } from '@/lib/cron/auth';
import { getDb } from '@/lib/db';
import { SUGGEST_RETRIES } from '@/lib/suggestions/dispatch';
import { isSuggestionSourceType, isUuid } from '@/lib/suggestions/types';
import { runSuggestJob } from '@/lib/suggestions/worker';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const POST: APIRoute = async ({ request }) => {
  if (!isCronAuthorized(request)) return unauthorizedResponse();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Malformed jobs will never parse; a 4xx would only be retried, so ack.
    return json({ skipped: 'invalid body' });
  }
  const { sourceType, sourceId, trigger, runId } = body;
  if (
    !isSuggestionSourceType(sourceType) ||
    !isUuid(sourceId) ||
    (trigger !== 'auto' && trigger !== 'manual') ||
    (runId !== undefined && !isUuid(runId))
  ) {
    return json({ skipped: 'invalid job' });
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const retries = Number(request.headers.get('Upstash-Retried') ?? '0');
  const outcome = await runSuggestJob(
    db,
    { sourceType, sourceId, trigger, ...(runId ? { runId } : {}) },
    { retried: retries > 0, finalAttempt: retries >= SUGGEST_RETRIES }
  );

  if (outcome.state === 'failed') return json({ state: 'failed', error: outcome.error }, 503);
  if (outcome.state === 'skipped') return json({ skipped: outcome.reason });
  return json({ state: 'started', runId: outcome.runId });
};
