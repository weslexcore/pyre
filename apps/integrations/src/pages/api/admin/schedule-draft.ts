// "Draft schedule" trigger: sync Momence coverage windows first (so the agent
// sees current reality), then start one pyre-agents Eve session per requested
// week. The week view sends a single week; the month and Set views send every
// week in view that still has uncovered shifts, and the To draft view the
// weeks the admin picked. Drafts only fill uncovered shifts — the
// agent is instructed to and /api/agent/proposals enforces it. Returns
// immediately with the session ids — the board polls for the resulting
// proposals rather than holding this request open through the agent runs.
// An optional `prompt` carries the admin's last-minute steer into every
// session's opening message (see lib/schedule/draft-prompt). The run itself
// is lib/schedule/draft-run, shared with Pyre Agent.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { json } from '@/lib/http/route';
import { loadScheduleDraft } from '@/lib/pyre-agent/schedule';
import { actorFromGate } from '@/lib/schedule/change-log';
import { MAX_DRAFT_WEEKS } from '@/lib/schedule/draft-prompt';
import { isWeekStart, parseDraftNote, startDraftRuns } from '@/lib/schedule/draft-run';

export const prerender = false;

/**
 * GET ?weekStart=YYYY-MM-DD → the week's open draft, item by item, and
 * whether a draft or revision is still being worked on. Pyre Agent's chat
 * polls it to show a draft it started (ScheduleDraftWatch).
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);
  const weekStart = url.searchParams.get('weekStart');
  if (!isWeekStart(weekStart)) {
    return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
  }
  return json(await loadScheduleDraft(db, weekStart));
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // One week (weekStart — the original shape) or several (weekStarts — the
  // month view drafting every week that still has uncovered shifts).
  const rawWeeks: unknown[] = Array.isArray(body.weekStarts)
    ? body.weekStarts
    : body.weekStart !== undefined
      ? [body.weekStart]
      : [];
  const uniqueWeeks = [...new Set(rawWeeks)];
  if (uniqueWeeks.length === 0 || uniqueWeeks.length > MAX_DRAFT_WEEKS) {
    return json({ error: `weekStarts must list 1–${MAX_DRAFT_WEEKS} weeks` }, 400);
  }
  if (!uniqueWeeks.every(isWeekStart)) {
    return json({ error: 'Each week start must be a Monday as YYYY-MM-DD' }, 400);
  }
  const weekStarts = (uniqueWeeks as string[]).sort();

  // Optional last-minute steer from the admin ("give Sarah a shift to lead").
  // The same note goes to every week in the run.
  const note = parseDraftNote(body.prompt, false);
  if (!note.ok) return json({ error: note.error }, 400);

  const result = await startDraftRuns(getDb(), weekStarts, note.note, {
    actor: actorFromGate(gate),
    origin: 'board',
  });
  if (!result.ok) {
    return json(
      { error: result.error, sessions: result.sessions, sync: result.sync },
      result.status
    );
  }

  // weekStart/sessionId mirror the first entry for the original single-week
  // response shape.
  const { sessions, sync } = result;
  return json(
    { ok: true, sessions, weekStart: weekStarts[0], sessionId: sessions[0]?.sessionId, sync },
    202
  );
};
