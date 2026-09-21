// The tasks under a goal, grouped by the column they sit in — To do, In
// progress, Done on the seeded board, whatever the columns are called on
// another one. Same rows as a board view, because a task should not look
// different depending on which page you found it from.

import type { BoardCardRow, BoardColumnRow, BoardRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { CardRow } from '../boards/CardRow';
import { cardClass, SectionTitle } from '../goalsUi';

export function TaskList({
  cards,
  columns,
  boards,
  people,
  today,
  busy = false,
  onOpen,
  onMove,
  /** Titles for cards filed under a sub-goal rather than this one. */
  goalTitles,
}: {
  cards: BoardCardRow[];
  columns: BoardColumnRow[];
  boards: BoardRow[];
  people: PeopleNames;
  today: string;
  busy?: boolean;
  onOpen: (card: BoardCardRow) => void;
  onMove: (card: BoardCardRow, columnId: string) => void;
  goalTitles?: Map<string, string>;
}) {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const boardOrder = new Map(boards.map((board) => [board.id, board.sort_order]));

  // Only the columns this goal's cards actually occupy, in board order then
  // column order: an empty "Blocked" column from another board would be
  // noise on a goal page.
  const occupied = [...new Set(cards.map((card) => card.column_id))]
    .map((id) => columnsById.get(id))
    .filter((column): column is BoardColumnRow => column !== undefined)
    .sort(
      (a, b) =>
        (boardOrder.get(a.board_id) ?? 0) - (boardOrder.get(b.board_id) ?? 0) ||
        a.sort_order - b.sort_order ||
        a.label.localeCompare(b.label)
    );

  if (cards.length === 0) {
    return (
      <p className="font-mono text-xs text-white/35">
        Nothing is filed under this goal yet. Add the first task above.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {occupied.map((column) => {
        const group = cards
          .filter((card) => card.column_id === column.id)
          .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
        return (
          <section key={column.id} className={cardClass}>
            <SectionTitle note={String(group.length)}>{column.label}</SectionTitle>
            <div className="space-y-2">
              {group.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  columns={columns.filter((c) => c.board_id === card.board_id)}
                  people={people}
                  today={today}
                  goalTitle={card.goal_id ? goalTitles?.get(card.goal_id) : undefined}
                  busy={busy}
                  onOpen={onOpen}
                  onMove={onMove}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
