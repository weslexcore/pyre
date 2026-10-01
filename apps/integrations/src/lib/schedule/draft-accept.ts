// Shared "this draft row goes live" mechanics, used by the proposal review
// actions (✓ on an item) and by the edit routes — editing a draft shift or
// assignment counts as accepting it, so an admin can tweak the agent's
// recommendation and land it on the schedule in one move.

import { addDays } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChangeActor } from '@/lib/schedule/change-log';
import { fillOnCall } from '@/lib/schedule/on-call';

/** Who the log credits when a proposal closes itself after its last item. */
const RESOLVE_ACTOR: ChangeActor = { kind: 'system', email: null, label: 'Draft review' };

/**
 * Flip a draft row live: clear is_draft, and for an assignment also clear the
 * parent shift's (a live assignment must never reference a draft shift). Then
 * auto-resolve the owning proposal to approved when no draft rows remain.
 * Returns an error message, or null on success.
 */
export async function acceptDraftRow(
  db: SupabaseClient,
  item: {
    kind: 'shift' | 'assignment';
    id: string;
    /** The assignment's parent shift — required when kind is 'assignment'. */
    shiftId?: string;
    proposalId: string | null;
  }
): Promise<string | null> {
  const table = item.kind === 'shift' ? 'shifts' : 'shift_assignments';
  const { error } = await db.from(table).update({ is_draft: false }).eq('id', item.id);
  if (error) return error.message;

  if (item.kind === 'assignment' && item.shiftId) {
    const { error: shiftError } = await db
      .from('shifts')
      .update({ is_draft: false })
      .eq('id', item.shiftId)
      .eq('is_draft', true);
    if (shiftError) return shiftError.message;
  }

  if (item.proposalId) await resolveProposalIfDone(db, item.proposalId);
  return null;
}

/**
 * Once a draft week has gone live, re-plan its on-call from what actually
 * landed (the proposal's onCall was the recommendation for the whole draft;
 * rejected items may have changed the answer). Best-effort: a failure is
 * warned and the board's Auto on-call fixes it.
 */
export async function settleOnCallForWeek(
  db: SupabaseClient,
  weekStart: string,
  actor: ChangeActor
): Promise<void> {
  const result = await fillOnCall(db, {
    start: weekStart,
    end: addDays(weekStart, 6),
    actor,
    why: `Draft for week of ${weekStart} approved`,
  });
  if ('error' in result) {
    console.warn('[draft-accept] on-call re-plan failed:', result.error.message);
  }
}

/**
 * Mark a proposal approved once nothing in it is left to review, and settle
 * that week's on-call. Best-effort: a failed count just leaves the proposal
 * open for the next action to close.
 */
export async function resolveProposalIfDone(db: SupabaseClient, proposalId: string): Promise<void> {
  const [shiftsLeft, assignmentsLeft] = await Promise.all([
    db
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('proposal_id', proposalId)
      .eq('is_draft', true),
    db
      .from('shift_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('proposal_id', proposalId)
      .eq('is_draft', true),
  ]);
  if (!shiftsLeft.error && !assignmentsLeft.error && !shiftsLeft.count && !assignmentsLeft.count) {
    const { data } = await db
      .from('schedule_proposals')
      .update({ status: 'approved', decided_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('status', 'draft')
      .select('week_start');
    // Only the call that actually closed it settles on-call.
    const closed = (data ?? [])[0] as { week_start: string } | undefined;
    if (closed) await settleOnCallForWeek(db, closed.week_start, RESOLVE_ACTOR);
  }
}
