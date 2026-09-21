// The order of one column, set whole. A drag that reorders a column sends
// every card id in the column in its new order; this renumbers them ten
// apart. Nothing else about a card changes here — a drop that also moved
// the card between columns goes through PATCH /api/admin/board-cards first,
// so completion stamps, events, and notices happen in the one place that
// knows how — and the order is not history, so no event is written.
//
//   POST { board, columnId, cardIds: [<uuid>, …] } → { ok: true }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canViewBoard } from '@/lib/boards/access';
import { sortOrdersFor } from '@/lib/boards/reorder';
import { type APIRoute, beginMutation, isUuidParam, json } from '@/lib/boards/route';
import { loadBoardBySlug, loadColumn } from '@/lib/boards/store';
import { BOARD_LIMITS, isBoardSlug } from '@/lib/boards/types';

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, body, gate } = ready;

  const slug = typeof body.board === 'string' ? body.board : '';
  if (!isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!canViewBoard(gate.access, slug)) return json({ error: 'Board not found' }, 404);
  if (!isUuidParam(body.columnId)) return json({ error: 'columnId must be a UUID' }, 400);

  const ids = Array.isArray(body.cardIds) ? body.cardIds : null;
  if (!ids || ids.length === 0 || !ids.every(isUuidParam)) {
    return json({ error: 'cardIds must be a non-empty list of UUIDs' }, 400);
  }
  if (ids.length > BOARD_LIMITS.cardsPerBoard) return json({ error: 'Too many cards' }, 400);
  if (new Set(ids).size !== ids.length) return json({ error: 'cardIds repeats a card' }, 400);

  const board = await loadBoardBySlug(db, slug);
  if (!board) return json({ error: 'Board not found' }, 404);
  const column = await loadColumn(db, body.columnId);
  if (!column || column.board_id !== board.id) {
    return json({ error: 'That column is not on this board' }, 400);
  }

  // Every id must be a card sitting in this column right now — a list that
  // names a card somewhere else would renumber it without moving it.
  const { data, error: loadError } = await db
    .from('board_cards')
    .select('id')
    .eq('board_id', board.id)
    .eq('column_id', column.id)
    .in('id', ids);
  if (loadError) return json({ error: loadError.message }, 500);
  if (((data ?? []) as { id: string }[]).length !== ids.length) {
    return json({ error: 'Some of those cards are not in this column' }, 409);
  }

  for (const [id, sortOrder] of sortOrdersFor(ids)) {
    const { error } = await db.from('board_cards').update({ sort_order: sortOrder }).eq('id', id);
    if (error) return json({ error: error.message }, 500);
  }
  return json({ ok: true });
};
