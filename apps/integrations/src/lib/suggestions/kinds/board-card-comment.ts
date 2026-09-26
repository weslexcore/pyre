// board_card.comment: a comment on a card that already covers the work, so a
// second report of the same problem lands on the first one's card instead of
// making a duplicate.

import { addCardComment } from '@/lib/boards/comment';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardCardRow, BoardEventRow } from '@/lib/db';
import { cardHref, PAYLOAD_PARSERS } from '../types';
import { type KindHandler, originDetail } from './handler';

async function cardWithBoard(
  db: Parameters<KindHandler<'board_card.comment'>['validate']>[0],
  cardId: string
): Promise<{
  card: Pick<BoardCardRow, 'id' | 'title' | 'board_id'>;
  slug: string;
  archived: boolean;
} | null> {
  const { data } = await db
    .from('board_cards')
    .select('id, title, board_id')
    .eq('id', cardId)
    .maybeSingle();
  const card = data as Pick<BoardCardRow, 'id' | 'title' | 'board_id'> | null;
  if (!card) return null;
  const { data: board } = await db
    .from('boards')
    .select('slug, archived')
    .eq('id', card.board_id)
    .maybeSingle();
  const b = board as { slug: string; archived: boolean } | null;
  if (!b) return null;
  return { card, slug: b.slug, archived: b.archived };
}

export const boardCardComment: KindHandler<'board_card.comment'> = {
  parse: PAYLOAD_PARSERS['board_card.comment'],

  async validate(db, payload) {
    const found = await cardWithBoard(db, payload.cardId);
    if (!found || found.archived) {
      return { ok: false, status: 404, error: `No card ${payload.cardId} on an active board` };
    }
    return { ok: true, payload, target: { type: 'board_card', id: payload.cardId } };
  },

  async apply(db, payload, context) {
    const found = await cardWithBoard(db, payload.cardId);
    if (!found) throw new Error('That card no longer exists');
    const href = cardHref(found.slug, found.card.id);

    // A retry after a crash finds the comment the first attempt wrote.
    const { data: existing } = await db
      .from('board_events')
      .select('id')
      .eq('card_id', payload.cardId)
      .contains('detail', { suggestion_id: context.suggestion.id })
      .maybeSingle();
    if (existing) {
      const event = existing as Pick<BoardEventRow, 'id'>;
      return { resultType: 'board_event', resultId: event.id, label: found.card.title, href };
    }

    // The link back is appended here rather than left in the editable text,
    // so it survives whatever the admin does to the wording.
    const footer = context.origin
      ? `\n\nFrom [${context.origin.label}](${context.origin.href})`
      : '';
    const note = `${payload.note}${footer}`.slice(0, BOARD_LIMITS.comment);
    const added = await addCardComment(db, {
      cardId: payload.cardId,
      note,
      actor: context.actor,
      detail: originDetail(context),
    });
    if (!added.ok) throw new Error(added.error);
    return { resultType: 'board_event', resultId: added.event.id, label: found.card.title, href };
  },
};
