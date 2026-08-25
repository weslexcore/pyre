// Shared "this draft row goes live" mechanics, used by the proposal review
// actions (✓ on an item) and by the edit routes — editing a draft shift or
// assignment counts as accepting it, so an admin can tweak the agent's
// recommendation and land it on the schedule in one move.

import type { SupabaseClient } from '@supabase/supabase-js';

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
 * Mark a proposal approved once nothing in it is left to review. Best-effort:
 * a failed count just leaves the proposal open for the next action to close.
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
    await db
      .from('schedule_proposals')
      .update({ status: 'approved', decided_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('status', 'draft');
  }
}
