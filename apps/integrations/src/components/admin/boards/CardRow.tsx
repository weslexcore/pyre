// One card, as a row. The same component on a board column and in All
// Tasks — a task and a lead look alike because they are the same row, and a
// founder scanning All Tasks should not have to learn two layouts.
//
// The row is a button that opens the drawer, where everything about the
// card lives, the column included. On a board the row can also be picked up
// and dropped on another column (dnd.tsx hands in the listeners), which is
// how a card moves twenty times a day without a control crowding every row.

import type { HTMLAttributes } from 'react';
import { formatProperty } from '@/lib/boards/validate';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { ColumnDot, cardAnchorId, DueChip, QuietChip, rowClass, WaitingBadge } from '../goalsUi';

export interface CardRowProps {
  card: BoardCardRow;
  /** The board's live columns, for the inline move select. */
  columns: BoardColumnRow[];
  people: PeopleNames;
  today: string;
  /** Fields flagged show_on_card, so a lead carries its contact and date. */
  fields?: BoardFieldRow[];
  /** The goal this card is filed under, when the surrounding view isn't it. */
  goalTitle?: string;
  /** The board this card is on, when the view spans boards. */
  boardName?: string;
  onOpen: (card: BoardCardRow) => void;
  /** Drag listeners and ARIA attributes from dnd.tsx, spread onto the row. */
  dragProps?: HTMLAttributes<HTMLButtonElement>;
  /** True for the ghost being carried, which needs no controls. */
  ghost?: boolean;
}

// A chip is one line, so one that outgrows the row (a long field value,
// a long board name) is cut with an ellipsis instead of widening the page;
// the drawer has the whole of it.
const chipClip = 'max-w-full overflow-hidden text-ellipsis';

/** Where a card came from, when it was not made here by hand. */
const SOURCE_CHIPS: Partial<Record<BoardCardRow['source'], string>> = {
  intake: 'from the web',
  form: 'from a form',
};

export function CardRow({
  card,
  columns,
  people,
  today,
  fields = [],
  goalTitle,
  boardName,
  onOpen,
  dragProps,
  ghost = false,
}: CardRowProps) {
  const column = columns.find((c) => c.id === card.column_id);
  const finished = card.completed_at !== null;
  const shown = fields
    .filter((field) => field.show_on_card && card.properties[field.key] != null)
    .map((field) => ({ field, text: formatProperty(field, card.properties[field.key]) }))
    .filter(({ text }) => text !== '');

  return (
    <div id={ghost ? undefined : cardAnchorId(card)}>
      <button
        type="button"
        className={`${rowClass} ${dragProps ? 'cursor-grab touch-manipulation active:cursor-grabbing' : ''} ${
          ghost ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-black)] shadow-xl' : ''
        }`}
        onClick={() => onOpen(card)}
        {...dragProps}
      >
        <span className="mt-0.5">{column && <ColumnDot column={column} />}</span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${
              finished ? 'text-white/40 line-through' : 'text-[var(--pyre-creme)]'
            }`}
          >
            {card.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {card.owner_email && <QuietChip>{personName(card.owner_email, people)}</QuietChip>}
            {card.due_date && <DueChip dueDate={card.due_date} today={today} finished={finished} />}
            {card.waiting_on && !finished && <WaitingBadge waitingOn={card.waiting_on} />}
            {goalTitle && <QuietChip className={chipClip}>{goalTitle}</QuietChip>}
            {boardName && <QuietChip className={chipClip}>{boardName}</QuietChip>}
            {card.area && <QuietChip>{card.area}</QuietChip>}
            {SOURCE_CHIPS[card.source] && <QuietChip>{SOURCE_CHIPS[card.source]}</QuietChip>}
            {shown.map(({ field, text }) => (
              <QuietChip key={field.key} className={chipClip}>
                {field.label}: {text}
              </QuietChip>
            ))}
          </span>
        </span>
      </button>
    </div>
  );
}
