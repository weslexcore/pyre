// The classify worker: QStash calls this for every job lib/classify/dispatch
// publishes (a shift note written or edited, an admin's "Run again") and
// retries it with backoff on any non-2xx. It reads the record's current text
// itself, so a job queued before a later edit classifies the latest text.
//
//   POST { subject, id, force? } → 200 { state } | 200 { skipped }
//                                   503 when pyre-agents or Jev failed (QStash retries)
//
// Auth: Bearer CRON_SECRET, forwarded by QStash (same as the cron tick).

import { isSubjectType } from '@pyre/signals-core';
import type { APIRoute } from 'astro';
import { runClassification } from '@/lib/classify/request';
import { SUBJECT_SOURCES } from '@/lib/classify/subjects';
import { isCronAuthorized, unauthorizedResponse } from '@/lib/cron/auth';
import { getDb } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request }) => {
  if (!isCronAuthorized(request)) return unauthorizedResponse();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Malformed jobs will never parse; a 4xx would only be retried, so ack.
    return json({ skipped: 'invalid body' });
  }
  const { subject, id } = body;
  if (!isSubjectType(subject) || typeof id !== 'string' || !UUID_RE.test(id)) {
    return json({ skipped: 'invalid job' });
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const text = await SUBJECT_SOURCES[subject].loadText(db, id);
  if (text === null) return json({ skipped: 'record deleted' });

  // A retry means an earlier delivery failed or died mid-run, possibly
  // leaving the row pending; force past the "already in flight" skip.
  const retried = Number(request.headers.get('Upstash-Retried') ?? '0') > 0;
  const view = await runClassification(db, subject, id, text, {
    force: body.force === true || retried,
  });

  if (!view) return json({ skipped: 'classifier off or superseded' });
  if (view.state === 'failed') return json({ state: 'failed' }, 503);
  return json({ state: view.state });
};
