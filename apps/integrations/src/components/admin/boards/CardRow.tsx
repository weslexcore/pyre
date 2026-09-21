// One card, as a row. The same component on a board column, on a goal page,
// and in All Tasks — a task and a lead look alike because they are the same
// row, and a founder scanning All Tasks should not have to learn two layouts.
//
// The row is a button that opens the drawer; the column select beside it is
// the only control that acts in place, because moving a card is the thing
// people do twenty times a day and opening a drawer to do it would be a
// tax. No drag-and-drop: there is no such library in this app, and a select
// works on a phone, which is where half of this gets used.

import { formatProperty } from '@/lib/boards/validate';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import {
  ColumnDot,
  cardAnchorId,
  DueChip,
  QuietChip,
  rowClass,
  selectClass,
  WaitingBadge,
} from '../goalsUi';

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
  onMove: (card: BoardCardRow, columnId: string) => void;
  busy?: boolean;
}

export function CardRow({
  card,
  columns,
  people,
  today,
  fields = [],
  goalTitle,
  boardName,
  onOpen,
  onMove,
  busy = false,
}: CardRowProps) {
  const column = columns.find((c) => c.id === card.column_id);
  const finished = card.completed_at !== null;
  // An archived column still shows for the card sitting in it, so nothing is
  // stranded somewhere the select cannot name.
  const options = columns.filter((c) => !c.archived || c.id === card.column_id);
  const shown = fields.filter((field) => field.show_on_card && card.properties[field.key] != null);

  return (
    <div className="flex items-stretch gap-2" id={cardAnchorId(card)}>
      <button type="button" className={`${rowClass} flex-1`} onClick={() => onOpen(card)}>
        <span className="mt-1.5">{column && <ColumnDot kind={column.kind} />}</span>
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
            {goalTitle && <QuietChip>{goalTitle}</QuietChip>}
            {boardName && <QuietChip>{boardName}</QuietChip>}
            {card.area && <QuietChip>{card.area}</QuietChip>}
            {card.source === 'intake' && <QuietChip>from the web</QuietChip>}
            {shown.map((field) => (
              <QuietChip key={field.key}>
                {field.label}: {formatProperty(field, card.properties[field.key])}
              </QuietChip>
            ))}
          </span>
        </span>
      </button>

      <label className="sr-only" htmlFor={`move-${card.id}`}>
        Move {card.title}
      </label>
      <select
        id={`move-${card.id}`}
        className={`${selectClass} w-[7.5rem] shrink-0`}
        value={card.column_id}
        disabled={busy}
        onChange={(e) => onMove(card, e.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
