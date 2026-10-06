// Adding a comment to a card's thread, wherever it was written: the card
// drawer (api/admin/board-events.ts) and an admin approving an agent's
// suggestion to comment on an existing card (lib/suggestions). Server-only.
//
// Unlike every other board write, a comment is the payload rather than a side
// effect, so it is inserted directly and a failure is returned: a swallowed
// failure would lose what somebody wrote.
//
// A comment can carry files its author uploaded for it (staged, then claimed
// here once the comment exists), and may be files alone with no words.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardAttachmentRow, BoardEventRow, BoardRow } from '@/lib/db';
import { notifyCardComment } from '@/lib/notifications/goals';
import { claimCommentAttachments, countClaimableCommentFiles } from './card-media';
import { formatFileCount } from './files';
import { loadCard } from './store';

/** What a notice says for a comment: its words, or what it shared when it has none. */
export function commentNoticeText(note: string, fileCount: number): string {
  if (note.trim()) return note;
  return fileCount === 1 ? 'Shared a file.' : `Shared ${formatFileCount(fileCount)}.`;
}

export async function addCardComment(
  db: SupabaseClient,
  input: {
    cardId: string;
    note: string;
    actor: string;
    detail?: Record<string, unknown>;
    /** Staged uploads the author picked for this comment. */
    attachmentIds?: string[];
  }
): Promise<
  | { ok: true; event: BoardEventRow; attachments: BoardAttachmentRow[] }
  | { ok: false; error: string; status?: number }
> {
  const card = await loadCard(db, input.cardId);
  const ids = input.attachmentIds ?? [];
  // The files are claimed once the comment exists, so count them first: a
  // comment that is only files must have files to carry.
  const claimable =
    card && ids.length > 0
      ? await countClaimableCommentFiles(db, { boardId: card.board_id, actor: input.actor, ids })
      : 0;
  if (!input.note.trim() && claimable === 0) {
    return {
      ok: false,
      status: 409,
      error: 'Those files are no longer waiting to be posted. Pick them again.',
    };
  }

  const { data, error } = await db
    .from('board_events')
    .insert({
      card_id: input.cardId,
      goal_id: null,
      action: 'comment',
      actor: input.actor,
      detail: { ...(input.detail ?? {}), ...(claimable > 0 ? { files: claimable } : {}) },
      note: input.note,
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };

  const event = data as BoardEventRow;
  const attachments = card
    ? await claimCommentAttachments(db, {
        boardId: card.board_id,
        cardId: card.id,
        eventId: event.id,
        actor: input.actor,
        ids,
      })
    : [];

  // Notify the assignees and explicitly mentioned users who can read the card.
  if (card) {
    const { data: boardRow } = await db
      .from('boards')
      .select('*')
      .eq('id', card.board_id)
      .maybeSingle();
    const board = (boardRow as BoardRow) ?? null;
    if (board) {
      await notifyCardComment(
        db,
        card,
        board,
        commentNoticeText(input.note, attachments.length),
        input.actor
      );
    }
  }

  return { ok: true, event, attachments };
}
