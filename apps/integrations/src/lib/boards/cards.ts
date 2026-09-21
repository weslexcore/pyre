// What moving a card between columns means, and the small orderings a board
// view needs. Pure and client-safe.
//
// The column is the state. There is no separate status column on a card and
// no "is done" flag to keep in step with it: a card is finished because it is
// sitting in a column whose kind says so. `completed_at` is a stamp that
// follows the move, applied here so the route and the island can never
// disagree about when it gets set.

import type { BoardCardRow, BoardColumnRow } from '@/lib/db';
import { isFinishedKind } from './types';

/** The columns a move is allowed to touch. */
export type ColumnPatch = Pick<
  BoardCardRow,
  'column_id' | 'completed_at' | 'completed_by' | 'waiting_on'
>;

/**
 * The patch that moves `card` into `next`. Null when the card is already
 * there — a move that moves nothing should not write a row or an event.
 *
 * Entering a finished column (done or dropped) stamps completion and clears
 * `waiting_on`: a card nobody is working on any more is not waiting on
 * anybody, and leaving the badge behind would strand "waiting on Sarah" on a
 * task that shipped last month. Leaving one clears the stamp, so a card
 * pulled back out of Done reads as open again.
 */
export function columnPatch(
  card: Pick<BoardCardRow, 'column_id' | 'completed_at' | 'completed_by' | 'waiting_on'>,
  next: Pick<BoardColumnRow, 'id' | 'kind'>,
  email: string,
  nowIso: string
): ColumnPatch | null {
  if (card.column_id === next.id) return null;

  const finished = isFinishedKind(next.kind);
  return {
    column_id: next.id,
    completed_at: finished ? (card.completed_at ?? nowIso) : null,
    completed_by: finished ? (card.completed_by ?? email) : null,
    waiting_on: finished ? null : card.waiting_on,
  };
}

/** Whether this card has landed somewhere final. */
export function isFinished(
  card: Pick<BoardCardRow, 'column_id'>,
  columnsById: Map<string, Pick<BoardColumnRow, 'kind'>>
): boolean {
  const kind = columnsById.get(card.column_id)?.kind;
  return kind === undefined ? false : isFinishedKind(kind);
}

/**
 * Cards grouped under the columns they sit in, columns in board order,
 * cards in hand order then age. Archived columns appear only when they still
 * hold cards — an emptied-out column stops cluttering the board, and one that
 * doesn't stays visible until its cards are moved somewhere current.
 */
export function cardsByColumn<
  C extends Pick<BoardCardRow, 'column_id' | 'sort_order' | 'created_at'>,
>(columns: BoardColumnRow[], cards: C[]): { column: BoardColumnRow; cards: C[] }[] {
  const grouped = new Map<string, C[]>();
  for (const card of cards) {
    const group = grouped.get(card.column_id);
    if (group) group.push(card);
    else grouped.set(card.column_id, [card]);
  }
  for (const group of grouped.values()) {
    group.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  }
  return [...columns]
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .filter((column) => !column.archived || (grouped.get(column.id)?.length ?? 0) > 0)
    .map((column) => ({ column, cards: grouped.get(column.id) ?? [] }));
}

/**
 * Where a new card goes: after everything already in that column. Quick-add
 * appends rather than prepending, so the column reads in the order the work
 * was thought of.
 */
export function nextSortOrder(
  cards: Pick<BoardCardRow, 'column_id' | 'sort_order'>[],
  columnId: string
): number {
  let max = 0;
  for (const card of cards) {
    if (card.column_id === columnId && card.sort_order > max) max = card.sort_order;
  }
  return max + 10;
}

/** The column a quick-add drops into: the first open one on the board. */
export function defaultColumn(columns: BoardColumnRow[]): BoardColumnRow | null {
  const open = columns
    .filter((column) => !column.archived && column.kind === 'open')
    .sort((a, b) => a.sort_order - b.sort_order);
  return open[0] ?? columns.find((column) => !column.archived) ?? null;
}
