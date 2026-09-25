// What the classifier found in records a page is showing, and a way to run
// it on demand. The page that lists the records normally carries their
// classifications itself (see loadClassifications); this route serves the
// follow-ups — polling notes that are still being read, and an admin's
// "Classify" on any record: one never classified (written before the
// classifier existed), one that failed, or one that read wrong. The run is
// queued like any other classification (after the response), forced past
// the unchanged-text skip, and recorded in the record's activity with the
// admin who asked for it; the page polls for the answer.
//
// An admin can also reclassify many records at once (the shift notes page's
// bulk panel picks them with its own filters): the records' rows are marked
// pending straight away, and the jobs go to QStash in batches, run a few at a
// time (lib/classify/dispatch).
//
//   GET  ?subject=shift_note&ids=<uuid>,<uuid>  → { classifications }
//   POST { subject, id }                        → 202 { classification: pending }
//   POST { subject, ids: [<uuid>, ...] }        → 202 { classifications, queued, missing }
//
// Who may do either is the subject's call (lib/classify/subjects.ts).

import { isSubjectType } from '@pyre/signals-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { dispatchClassifications, scheduleClassification } from '@/lib/classify/dispatch';
import { loadClassifications, markQueued, pendingView } from '@/lib/classify/request';
import { SUBJECT_SOURCES } from '@/lib/classify/subjects';
import { getDb } from '@/lib/db';
import { jevOptions } from '@/lib/jev';
import { normalizeEmail } from '@/lib/shift-notes/access';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A poll covers what is on screen; more than this is a client bug. */
const MAX_IDS = 100;

/** One bulk reclassify at most: the whole log the page loads (its LIST_LIMIT). */
const MAX_BULK = 500;

export const GET: APIRoute = async ({ cookies, url }) => {
  const subject = url.searchParams.get('subject');
  if (!isSubjectType(subject)) return json({ error: 'Unknown subject' }, 400);

  const gate = await SUBJECT_SOURCES[subject].authorize(cookies);
  if (gate instanceof Response) return gate;

  const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').filter(Boolean))];
  if (ids.length > MAX_IDS || ids.some((id) => !UUID_RE.test(id))) {
    return json({ error: `ids must be up to ${MAX_IDS} comma-separated UUIDs` }, 400);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  return json({ classifications: await loadClassifications(db, subject, ids) });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const subject = body.subject;
  if (!isSubjectType(subject)) return json({ error: 'Unknown subject' }, 400);

  const source = SUBJECT_SOURCES[subject];
  const gate = await source.authorize(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);
  if (!jevOptions()) {
    return json({ error: 'Classifier unavailable (AI_GATEWAY_API_KEY not configured)' }, 503);
  }
  const requestedBy = normalizeEmail(gate.user.email);
  const options = { force: true, ...(requestedBy ? { requestedBy } : {}) };

  if (body.ids !== undefined) {
    if (
      !Array.isArray(body.ids) ||
      body.ids.length === 0 ||
      body.ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      return json({ error: 'ids must be a non-empty array of UUIDs' }, 400);
    }
    const ids = [...new Set(body.ids as string[])];
    if (ids.length > MAX_BULK) {
      return json({ error: `At most ${MAX_BULK} records per bulk run` }, 400);
    }

    let texts: Map<string, string>;
    try {
      texts = await source.loadTexts(db, ids);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Load failed' }, 500);
    }
    const items = ids.flatMap((id) => {
      const text = texts.get(id);
      return text === undefined ? [] : [{ id, text }];
    });

    await markQueued(db, subject, items);
    const outcome = await dispatchClassifications(subject, items, options);
    if (outcome.via === 'none' && items.length > 0) return json({ error: outcome.reason }, 503);

    const pending = pendingView();
    return json(
      {
        classifications: Object.fromEntries(items.map((item) => [item.id, pending])),
        queued: items.length,
        // Deleted since the page loaded.
        missing: ids.length - items.length,
      },
      202
    );
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const text = await source.loadText(db, id);
  if (text === null) return json({ error: 'Not found' }, 404);

  scheduleClassification(subject, id, text, options);
  return json({ classification: pendingView() }, 202);
};
