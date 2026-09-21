// What a drop means for the order of a column. Pure and client-safe: the
// island works out the plan, shows it at once, and sends it; the reorder
// route renumbers the column to match.
//
// A card can be dropped on another card (take that card's place, pushing it
// and everything after it down) or on the column itself (go last). Either
// way the answer is the column and the full order of ids it should hold,
// because "put this one third" is only meaningful as the whole list.

import type { BoardCardRow, BoardColumnRow } from '@/lib/db';

export interface DropPlan {
  card: Pick<BoardCardRow, 'id' | 'column_id'>;
  /** Where the card ends up. */
  columnId: string;
  /** True when the card left its column, so completion stamps may change. */
  moved: boolean;
  /** Every card the target column holds afterwards, top to bottom. */
  orderedIds: string[];
}

/** Cards in a column, in the order the board shows them. */
function columnOrder<
  C extends Pick<BoardCardRow, 'id' | 'column_id' | 'sort_order' | 'created_at'>,
>(cards: C[], columnId: string): C[] {
  return cards
    .filter((card) => card.column_id === columnId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

export function planDrop(
  drop: { activeId: string; overId: string | null },
  cards: Pick<BoardCardRow, 'id' | 'column_id' | 'sort_order' | 'created_at'>[],
  columns: Pick<BoardColumnRow, 'id' | 'archived'>[]
): DropPlan | null {
  if (!drop.overId) return null;
  const card = cards.find((row) => row.id === drop.activeId);
  if (!card) return null;

  const overCard = cards.find((row) => row.id === drop.overId);
  if (overCard && overCard.id === card.id) return null;
  const columnId = overCard ? overCard.column_id : drop.overId;
  const column = columns.find((row) => row.id === columnId);
  // An archived column keeps showing while it holds cards, but takes no new
  // ones; shuffling what is already in it is fine.
  if (!column || (column.archived && column.id !== card.column_id)) return null;

  const others = columnOrder(cards, columnId).filter((row) => row.id !== card.id);
  let index = others.length;
  if (overCard && overCard.id !== card.id) {
    index = others.findIndex((row) => row.id === overCard.id);
    // Dragging a card down its own column past the target: it takes the
    // slot after the target, since the target shifts up into the gap.
    const wasAbove =
      card.column_id === columnId &&
      columnOrder(cards, columnId).findIndex((row) => row.id === card.id) < index + 1 &&
      columnOrder(cards, columnId).findIndex((row) => row.id === card.id) <
        columnOrder(cards, columnId).findIndex((row) => row.id === overCard.id);
    if (wasAbove) index += 1;
  }

  const orderedIds = [
    ...others.slice(0, index).map((row) => row.id),
    card.id,
    ...others.slice(index).map((row) => row.id),
  ];
  const moved = columnId !== card.column_id;
  if (
    !moved &&
    orderedIds.join() ===
      columnOrder(cards, columnId)
        .map((row) => row.id)
        .join()
  ) {
    return null;
  }
  return { card, columnId, moved, orderedIds };
}

/** Sort orders for a column laid out as `orderedIds`, ten apart. */
export function sortOrdersFor(orderedIds: string[]): Map<string, number> {
  return new Map(orderedIds.map((id, index) => [id, (index + 1) * 10]));
}
