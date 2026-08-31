// "Revise draft" trigger: send the admin's follow-up note into the Eve
// session that drafted the week's open proposal, so the agent adjusts its
// draft conversationally instead of starting over. The new save_proposal
// supersedes the old draft; the board polls for it exactly like a fresh
// draft run. No Momence sync here — refinement rides on the board the
// original draft just synced, and should be fast.
//
// When the drafting session is gone (expired, or a cron draft whose
// schedule-triggered session already completed) a fresh session is started
// with the prior thread replayed, and the thread rows are re-keyed to the
// new session id so the conversation follows the superseding proposal.

import { type ScheduleDraftMessageRow, weekStartOf } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { actorFromGate, logScheduleChange } from '@/lib/schedule/change-log';
import {
  buildRefineFallbackMessage,
  buildRefineMessage,
  MAX_DRAFT_PROMPT_LENGTH,
  sanitizeDraftPrompt,
} from '@/lib/schedule/draft-prompt';
import { readEveSessionTail, sendEveFollowUp, startEveSession } from '@/lib/schedule/eve-session';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const AGENT_BUSY_ERROR =
  'The agent is still working on this week — wait for the current run to finish';

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const agentsBaseUrl = import.meta.env.AGENTS_BASE_URL;
  const channelSecret = import.meta.env.EVE_CHANNEL_SECRET;
  if (!agentsBaseUrl || !channelSecret) {
    return json({ error: 'Agent not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)' }, 503);
  }
  const eveConfig = {
    baseUrl: agentsBaseUrl,
    channelSecret,
    bypassSecret: import.meta.env.AGENTS_PROTECTION_BYPASS,
  };

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
  if (
    typeof weekStart !== 'string' ||
    !DATE_RE.test(weekStart) ||
    weekStartOf(weekStart) !== weekStart
  ) {
    return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
  }

  if (typeof body.prompt !== 'string') {
    return json({ error: 'prompt must be a string' }, 400);
  }
  if (body.prompt.length > MAX_DRAFT_PROMPT_LENGTH * 2) {
    return json({ error: `prompt must be ${MAX_DRAFT_PROMPT_LENGTH} characters or fewer` }, 400);
  }
  const prompt = sanitizeDraftPrompt(body.prompt);
  if (!prompt) return json({ error: 'Add a note describing the change you want' }, 400);

  // The week's open draft is what the conversation is about.
  const { data: proposal, error: proposalError } = await db
    .from('schedule_proposals')
    .select('id, agent_session_id')
    .eq('week_start', weekStart)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (proposalError) return json({ error: proposalError.message }, 500);
  if (!proposal) return json({ error: 'No open draft for that week' }, 404);

  const priorSessionId = proposal.agent_session_id as string | null;

  // Try to resume the drafting session; fall back to a fresh one when it's
  // gone. The tail read doubles as the concurrency guard: a session mid-turn
  // (or a continuation someone else just took) means one refine at a time.
  let sessionId = priorSessionId;
  let resumed = false;
  if (priorSessionId) {
    const tail = await readEveSessionTail(eveConfig, priorSessionId);
    if (tail.state === 'running') return json({ error: AGENT_BUSY_ERROR }, 409);
    if (tail.state === 'waiting') {
      const sent = await sendEveFollowUp(
        eveConfig,
        priorSessionId,
        tail.continuationToken,
        buildRefineMessage(weekStart, prompt)
      );
      if (!sent.ok && sent.reason === 'running') return json({ error: AGENT_BUSY_ERROR }, 409);
      if (!sent.ok) return json({ error: `Agent follow-up failed: ${sent.detail}` }, 502);
      resumed = true;
    }
  }

  if (!resumed) {
    // Fresh session with the conversation replayed. Cron drafts land here
    // routinely — their schedule-triggered sessions complete rather than park.
    let priorThread: ScheduleDraftMessageRow[] = [];
    if (priorSessionId) {
      const { data } = await db
        .from('schedule_draft_messages')
        .select('*')
        .eq('agent_session_id', priorSessionId)
        .order('created_at', { ascending: true });
      priorThread = (data ?? []) as ScheduleDraftMessageRow[];
    }

    try {
      sessionId = await startEveSession(
        eveConfig,
        buildRefineFallbackMessage(weekStart, prompt, priorThread)
      );
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Agent session failed' }, 502);
    }
    if (!sessionId) return json({ error: 'Agent did not return a session id' }, 502);

    // Re-key the thread so it stays attached when the superseding proposal
    // arrives carrying the new session id.
    if (priorSessionId) {
      const { error } = await db
        .from('schedule_draft_messages')
        .update({ agent_session_id: sessionId })
        .eq('agent_session_id', priorSessionId);
      if (error) console.warn('[schedule-draft-refine] thread re-key failed:', error.message);
    }
  }

  // Persist the admin's message under whichever session carried it.
  // Best-effort, same as the draft route: the turn is already in flight.
  if (sessionId) {
    const { error } = await db.from('schedule_draft_messages').insert({
      agent_session_id: sessionId,
      week_start: weekStart,
      role: 'admin',
      content: prompt,
    });
    if (error) console.warn('[schedule-draft-refine] thread insert failed:', error.message);
  }

  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'proposal',
    entityId: proposal.id as string,
    action: 'refine',
    summary: `Requested draft changes for week of ${weekStart}`,
    details: { sessionId, resumed, note: prompt },
  });

  return json({ ok: true, weekStart, sessionId, resumed }, 202);
};
