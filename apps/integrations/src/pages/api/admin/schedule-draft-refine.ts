// "Revise draft" trigger: send the admin's follow-up note into the Eve
// session that drafted the week's open proposal, so the agent adjusts its
// draft conversationally instead of starting over. The new save_proposal
// supersedes the old draft; the board polls for it exactly like a fresh
// draft run. No Momence sync here — refinement rides on the board the
// original draft just synced, and should be fast.
//
// When the drafting session is gone (expired, or one whose turn already
// completed) a fresh session is started
// with the prior thread replayed, and the thread rows are re-keyed to the
// new session id so the conversation follows the superseding proposal.
// The mechanics live in lib/schedule/draft-run, shared with Pyre Agent.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http/route';
import { actorFromGate } from '@/lib/schedule/change-log';
import { isWeekStart, parseDraftNote, refineDraft } from '@/lib/schedule/draft-run';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const weekStart = body.weekStart;
  if (!isWeekStart(weekStart)) {
    return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
  }
  if (typeof body.prompt !== 'string') {
    return json({ error: 'prompt must be a string' }, 400);
  }
  const note = parseDraftNote(body.prompt, true);
  if (!note.ok) return json({ error: note.error }, 400);

  const result = await refineDraft(db, weekStart, note.note, {
    actor: actorFromGate(gate),
    origin: 'board',
  });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ ok: true, weekStart, sessionId: result.sessionId, resumed: result.resumed }, 202);
};
