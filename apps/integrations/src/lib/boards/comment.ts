// Adding a comment to a card's thread, wherever it was written: the card
// drawer (api/admin/board-events.ts) and an admin approving an agent's
// suggestion to comment on an existing card (lib/suggestions). Server-only.
//
// Unlike every other board write, a comment is the payload rather than a side
// effect, so it is inserted directly and a failure is returned: a swallowed
// failure would lose what somebody wrote.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardEventRow, BoardRow } from '@/lib/db';
import { notifyCardComment } from '@/lib/notifications/goals';
import { loadCard } from './store';

export async function addCardComment(
  db: SupabaseClient,
  input: { cardId: string; note: string; actor: string; detail?: Record<string, unknown> }
): Promise<{ ok: true; event: BoardEventRow } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('board_events')
    .insert({
      card_id: input.cardId,
      goal_id: null,
      action: 'comment',
      actor: input.actor,
      detail: input.detail ?? {},
      note: input.note,
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };

  // Notify the owner and explicitly mentioned users who can read the card.
  const card = await loadCard(db, input.cardId);
  if (card) {
    const { data: boardRow } = await db
      .from('boards')
      .select('*')
      .eq('id', card.board_id)
      .maybeSingle();
    const board = (boardRow as BoardRow) ?? null;
    if (board) await notifyCardComment(db, card, board, input.note, input.actor);
  }

  return { ok: true, event: data as BoardEventRow };
}
