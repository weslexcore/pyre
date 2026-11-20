// Starting a schedule draft run, or revising the week's open draft, for
// whoever asked: the schedule board's buttons (/api/admin/schedule-draft and
// /api/admin/schedule-draft-refine) and Pyre Agent (/api/agent/pyre, for
// someone who manages the schedule) both come through here, so a draft asked
// for in the chat is the same run, with the same sync, prompt, thread and
// log, as one asked for on the board.
//
// Each run is recorded in schedule_draft_requests with who asked and where,
// so that when the scheduler saves its proposal (/api/agent/proposals) the
// person is told it is ready (settleDraftRequest), and the chat can show the
// draft is still coming. Server-only.

import { type ScheduleDraftMessageRow, weekStartOf } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { agentsEveConfig } from '@/lib/agent/eve-config';
import { createNotifications } from '@/lib/notifications/notify';
import { PYRE_AGENT_HREF } from '@/lib/pyre-agent/types';
import { type ChangeActor, logScheduleChange } from './change-log';
import {
  buildDraftMessage,
  buildRefineFallbackMessage,
  buildRefineMessage,
  MAX_DRAFT_PROMPT_LENGTH,
  MAX_DRAFT_WEEKS,
  sanitizeDraftPrompt,
} from './draft-prompt';
import { readEveSessionTail, sendEveFollowUp, startEveSession } from './eve-session';
import { type SyncShiftsSummary, syncShifts } from './sync';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A request that has not produced a proposal in this long is treated as finished (failed). */
export const DRAFT_REQUEST_LAPSE_MS = 20 * 60 * 1000;

export const AGENT_BUSY_ERROR =
  'The agent is still working on this week — wait for the current run to finish';

/** Where a draft was asked for, and by whom. */
export interface DraftRequester {
  actor: ChangeActor;
  origin: 'board' | 'pyre_agent';
  /** The Pyre Agent session it was asked from, for the link back. */
  pyreSessionId?: string | null;
}

export type DraftRunResult =
  | {
      ok: true;
      sessions: Array<{ weekStart: string; sessionId: string | null }>;
      sync: SyncShiftsSummary | { error: string };
    }
  | {
      ok: false;
      status: number;
      error: string;
      sessions?: Array<{ weekStart: string; sessionId: string | null }>;
      sync?: SyncShiftsSummary | { error: string };
    };

export type RefineResult =
  | { ok: true; weekStart: string; sessionId: string | null; resumed: boolean }
  | { ok: false; status: number; error: string };

/** Is this a Monday as YYYY-MM-DD? */
export function isWeekStart(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && weekStartOf(value) === value;
}

/** Validate and sanitise a note; returns the clean text or an error. */
export function parseDraftNote(
  raw: unknown,
  required: boolean
): { ok: true; note: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return required
      ? { ok: false, error: 'Add a note describing the change you want' }
      : { ok: true, note: '' };
  }
  if (typeof raw !== 'string') return { ok: false, error: 'prompt must be a string' };
  if (raw.length > MAX_DRAFT_PROMPT_LENGTH * 2) {
    return { ok: false, error: `prompt must be ${MAX_DRAFT_PROMPT_LENGTH} characters or fewer` };
  }
  const note = sanitizeDraftPrompt(raw);
  if (required && !note) return { ok: false, error: 'Add a note describing the change you want' };
  return { ok: true, note };
}

/** Best-effort: a failed insert must never fail a run that is already in flight. */
async function recordRequest(
  db: SupabaseClient | null,
  row: {
    weekStart: string;
    kind: 'draft' | 'refine';
    sessionId: string | null;
    requester: DraftRequester;
    note: string;
  }
): Promise<void> {
  if (!db || !row.sessionId || !row.requester.actor.email) return;
  const { error } = await db.from('schedule_draft_requests').insert({
    week_start: row.weekStart,
    kind: row.kind,
    agent_session_id: row.sessionId,
    requested_by: row.requester.actor.email,
    origin: row.requester.origin,
    pyre_session_id: row.requester.pyreSessionId ?? null,
    note: row.note,
  });
  if (error) console.warn('[draft-run] request insert failed:', error.message);
}

/**
 * Sync Momence coverage, then open one drafting session per week. `weekStarts`
 * must already be validated Mondays (1–MAX_DRAFT_WEEKS of them).
 */
export async function startDraftRuns(
  db: SupabaseClient | null,
  weekStarts: string[],
  note: string,
  requester: DraftRequester
): Promise<DraftRunResult> {
  const eveConfig = agentsEveConfig();
  if (!eveConfig) {
    return {
      ok: false,
      status: 503,
      error: 'Agent not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)',
    };
  }
  if (weekStarts.length === 0 || weekStarts.length > MAX_DRAFT_WEEKS) {
    return { ok: false, status: 400, error: `weekStarts must list 1–${MAX_DRAFT_WEEKS} weeks` };
  }

  // Fresh windows before drafting — a stale board is the agent's worst input.
  let sync: SyncShiftsSummary | { error: string };
  try {
    sync = await syncShifts({ actor: requester.actor });
  } catch (error) {
    // Draft anyway on sync failure (Momence hiccups shouldn't block a draft
    // of already-synced shifts), but say so.
    sync = { error: error instanceof Error ? error.message : 'Sync failed' };
  }

  const sessions: Array<{ weekStart: string; sessionId: string | null }> = [];
  for (const week of weekStarts) {
    let sessionId: string | null;
    try {
      sessionId = await startEveSession(eveConfig, buildDraftMessage(week, note));
    } catch (error) {
      return {
        ok: false,
        status: 502,
        error: `Agent session for week ${week} failed: ${error instanceof Error ? error.message : String(error)}`,
        sessions,
        sync,
      };
    }
    sessions.push({ weekStart: week, sessionId });
    await recordRequest(db, { weekStart: week, kind: 'draft', sessionId, requester, note });

    // The note opens the drafting conversation — persist it as the thread's
    // first message so the review banner can show what was asked.
    if (note && sessionId && db) {
      const { error } = await db.from('schedule_draft_messages').insert({
        agent_session_id: sessionId,
        week_start: week,
        role: 'admin',
        content: note,
      });
      if (error) console.warn('[draft-run] thread insert failed:', error.message);
    }
  }
  return { ok: true, sessions, sync };
}

/**
 * Send a revision note into the session that drafted the week's open
 * proposal, or — when that session is gone — a fresh one with the thread
 * replayed. The new save_proposal supersedes the old draft.
 */
export async function refineDraft(
  db: SupabaseClient,
  weekStart: string,
  note: string,
  requester: DraftRequester
): Promise<RefineResult> {
  const eveConfig = agentsEveConfig();
  if (!eveConfig) {
    return {
      ok: false,
      status: 503,
      error: 'Agent not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)',
    };
  }

  // The week's open draft is what the conversation is about.
  const { data: proposal, error: proposalError } = await db
    .from('schedule_proposals')
    .select('id, agent_session_id')
    .eq('week_start', weekStart)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (proposalError) return { ok: false, status: 500, error: proposalError.message };
  if (!proposal) return { ok: false, status: 404, error: 'No open draft for that week' };

  const priorSessionId = proposal.agent_session_id as string | null;

  // Try to resume the drafting session; fall back to a fresh one when it's
  // gone. The tail read doubles as the concurrency guard: a session mid-turn
  // means one refine at a time.
  let sessionId = priorSessionId;
  let resumed = false;
  if (priorSessionId) {
    const tail = await readEveSessionTail(eveConfig, priorSessionId);
    if (tail.state === 'running') return { ok: false, status: 409, error: AGENT_BUSY_ERROR };
    if (tail.state === 'waiting') {
      const sent = await sendEveFollowUp(
        eveConfig,
        priorSessionId,
        buildRefineMessage(weekStart, note)
      );
      if (!sent.ok && sent.reason === 'running') {
        return { ok: false, status: 409, error: AGENT_BUSY_ERROR };
      }
      if (!sent.ok && sent.reason === 'error') {
        return { ok: false, status: 502, error: `Agent follow-up failed: ${sent.detail}` };
      }
      // 'gone' (ended between the tail read and the send) falls back below.
      resumed = sent.ok;
    }
  }

  if (!resumed) {
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
        buildRefineFallbackMessage(weekStart, note, priorThread)
      );
    } catch (error) {
      return {
        ok: false,
        status: 502,
        error: error instanceof Error ? error.message : 'Agent session failed',
      };
    }
    if (!sessionId) return { ok: false, status: 502, error: 'Agent did not return a session id' };

    // Re-key the thread so it stays attached when the superseding proposal
    // arrives carrying the new session id.
    if (priorSessionId) {
      const { error } = await db
        .from('schedule_draft_messages')
        .update({ agent_session_id: sessionId })
        .eq('agent_session_id', priorSessionId);
      if (error) console.warn('[draft-run] thread re-key failed:', error.message);
    }
  }

  if (sessionId) {
    const { error } = await db.from('schedule_draft_messages').insert({
      agent_session_id: sessionId,
      week_start: weekStart,
      role: 'admin',
      content: note,
    });
    if (error) console.warn('[draft-run] thread insert failed:', error.message);
  }
  await recordRequest(db, { weekStart, kind: 'refine', sessionId, requester, note });

  await logScheduleChange(db, {
    actor: requester.actor,
    entityType: 'proposal',
    entityId: proposal.id as string,
    action: 'refine',
    summary: `Requested draft changes for week of ${weekStart}`,
    details: { sessionId, resumed, note, origin: requester.origin },
  });

  return { ok: true, weekStart, sessionId, resumed };
}

/** "Mon Nov 30" for a YYYY-MM-DD. */
function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The board on a given week. */
export function scheduleWeekHref(weekStart: string): string {
  return `/admin/schedule?view=week&date=${encodeURIComponent(weekStart)}`;
}

/**
 * A proposal just landed: close the request it answers and tell whoever
 * asked. A board request is not notified — the board is polling for it and
 * they are looking at it. A Pyre Agent request (a routine's included) links
 * back to the conversation, where the draft shows and can be revised or
 * confirmed. Best-effort: never fails the save.
 */
export async function settleDraftRequest(
  db: SupabaseClient,
  agentSessionId: string,
  proposal: { id: string; weekStart: string; summary: Record<string, unknown> }
): Promise<void> {
  const { data, error } = await db
    .from('schedule_draft_requests')
    .update({ proposal_id: proposal.id, completed_at: new Date().toISOString() })
    .eq('agent_session_id', agentSessionId)
    .is('completed_at', null)
    .select('id, requested_by, origin, pyre_session_id, kind');
  if (error) {
    console.warn('[draft-run] request settle failed:', error.message);
    return;
  }
  for (const request of (data ?? []) as {
    id: string;
    requested_by: string;
    origin: 'board' | 'pyre_agent';
    pyre_session_id: string | null;
    kind: 'draft' | 'refine';
  }[]) {
    if (request.origin !== 'pyre_agent') continue;
    const uncovered = Number(proposal.summary.uncoveredShifts ?? 0);
    const warnings = Array.isArray(proposal.summary.warnings)
      ? proposal.summary.warnings.length
      : 0;
    const bits = [
      uncovered > 0 ? `${uncovered} shift${uncovered === 1 ? '' : 's'} left uncovered` : null,
      warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    await createNotifications(db, [request.requested_by], {
      kind: 'schedule_change',
      title: `${request.kind === 'refine' ? 'Revised draft' : 'Draft schedule'} ready: week of ${shortDate(proposal.weekStart)}`,
      body: `Review it, ask for changes, or confirm parts of it in the chat.${bits.length ? ` ${bits.join(', ')}.` : ''}`,
      href: request.pyre_session_id
        ? `${PYRE_AGENT_HREF}?c=${encodeURIComponent(request.pyre_session_id)}`
        : scheduleWeekHref(proposal.weekStart),
      source: { type: 'proposal', id: proposal.id },
      actorEmail: null,
    });
  }
}
