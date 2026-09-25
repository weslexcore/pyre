// The classify worker: QStash calls this for every job lib/classify/dispatch
// publishes (a shift note written or edited, an admin's "Run again") and
// retries it with backoff on any non-2xx. It reads the record's current text
// itself, so a job queued before a later edit classifies the latest text.
//
//   POST { subject, id, force?, requestedBy?, thenSuggest? } → 200 { state } | 200 { skipped }
//                                   503 when AI Gateway or Jev failed (QStash retries)
//
// Auth: Bearer CRON_SECRET, forwarded by QStash (same as the cron tick).

import { isSubjectType } from '@pyre/signals-core';
import type { APIRoute } from 'astro';
import { runClassification } from '@/lib/classify/request';
import { SUBJECT_SOURCES } from '@/lib/classify/subjects';
import { isCronAuthorized, unauthorizedResponse } from '@/lib/cron/auth';
import { getDb } from '@/lib/db';
import { isUuid, json } from '@/lib/http/route';

export const prerender = false;

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
  if (!isSubjectType(subject) || typeof id !== 'string' || !isUuid(id)) {
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
    ...(typeof body.requestedBy === 'string' ? { requestedBy: body.requestedBy } : {}),
    ...(body.thenSuggest === true ? { thenSuggest: true } : {}),
  });

  if (!view) return json({ skipped: 'classifier off or superseded' });
  if (view.state === 'failed') return json({ state: 'failed' }, 503);
  return json({ state: view.state });
};
