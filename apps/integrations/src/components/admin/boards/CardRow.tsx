// One card, as a row. The same component on a board column and in All
// Tasks — a task and a lead look alike because they are the same row, and a
// founder scanning All Tasks should not have to learn two layouts.
//
// The row is a button that opens the drawer, where everything about the
// card lives, the column included. On a board the row can also be picked up
// and dropped on another column (dnd.tsx hands in the listeners), which is
// how a card moves twenty times a day without a control crowding every row.

import type { HTMLAttributes } from 'react';
import { type LinkSummary, linkedTitles } from '@/lib/boards/links';
import { describeRepeat, repeatRuleOf } from '@/lib/boards/recurrence';
import { hasAnyTerm, termSnippet } from '@/lib/boards/search';
import { formatProperty } from '@/lib/boards/validate';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import {
  AvatarStack,
  ColumnDot,
  cardAnchorId,
  DueChip,
  QuietChip,
  rowClass,
  WaitingBadge,
} from '../goalsUi';
import { TermsMarked } from '../Marked';

export interface CardRowProps {
  card: BoardCardRow;
  /** The board's live columns, for the inline move select. */
  columns: BoardColumnRow[];
  people: PeopleNames;
  today: string;
  /** Fields flagged show_on_card, so a lead carries its contact and date. */
  fields?: BoardFieldRow[];
  /** Linked cards by id, so a link field shows titles rather than a count. */
  links?: Map<string, LinkSummary>;
  /** The goal this card is filed under, when the surrounding view isn't it. */
  goalTitle?: string;
  /** The board this card is on, when the view spans boards. */
  boardName?: string;
  onOpen: (card: BoardCardRow) => void;
  /** Drag listeners and ARIA attributes from dnd.tsx, spread onto the row. */
  dragProps?: HTMLAttributes<HTMLButtonElement>;
  /** True for the ghost being carried, which needs no controls. */
  ghost?: boolean;
  /**
   * How the card's column shows: the dot alone (a board, where the column
   * around the card says the rest), the dot with the column's name (a view
   * grouped by something else), or nothing.
   */
  status?: 'dot' | 'label' | 'none';
  /**
   * The search's words (lib/boards/search searchTerms), marked in the title
   * and the waiting badge; a word found only in the notes brings the line
   * it is on under the title, since the row does not otherwise show notes.
   */
  highlight?: string[];
}

// A chip is one line, so one that outgrows the row (a long field value,
// a long board name) is cut with an ellipsis instead of widening the page;
// the drawer has the whole of it.
const chipClip = 'max-w-full overflow-hidden text-ellipsis';

/** Where a card came from, when it was not made here by hand. */
const SOURCE_CHIPS: Partial<Record<BoardCardRow['source'], string>> = {
  intake: 'from the web',
  form: 'from a form',
  suggestion: 'suggested',
};

export function CardRow({
  card,
  columns,
  people,
  today,
  fields = [],
  links,
  goalTitle,
  boardName,
  onOpen,
  dragProps,
  ghost = false,
  status = 'dot',
  highlight = [],
}: CardRowProps) {
  const column = columns.find((c) => c.id === card.column_id);
  const finished = card.completed_at !== null;
  const repeat = repeatRuleOf(card);
  const shown = fields
    .filter((field) => field.show_on_card && card.properties[field.key] != null)
    .map((field) => ({ field, text: shownText(field, card.properties[field.key], links) }))
    .filter(({ text }) => text !== '');
  const notesOnly = highlight.filter(
    (term) => !hasAnyTerm(card.title, [term]) && !hasAnyTerm(card.waiting_on ?? '', [term])
  );
  const snippet = notesOnly.length > 0 ? termSnippet(card.notes_md, notesOnly) : null;

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
        {status !== 'none' && (
          <span className="mt-0.5">{column && <ColumnDot column={column} />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${
              finished ? 'text-white/40 line-through' : 'text-[var(--pyre-creme)]'
            }`}
          >
            <TermsMarked text={card.title} terms={highlight} />
          </span>
          {snippet && (
            <span className="mt-0.5 block truncate text-xs text-white/50">
              <TermsMarked text={snippet} terms={highlight} />
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {status === 'label' && column && (
              <QuietChip className={chipClip}>{column.label}</QuietChip>
            )}
            {card.assignee_emails.length > 0 && (
              <AvatarStack
                emails={card.assignee_emails}
                names={(email) => personName(email, people)}
              />
            )}
            {card.due_date && (
              <DueChip
                dueDate={card.due_date}
                today={today}
                finished={finished}
                repeat={repeat ? describeRepeat(repeat) : null}
              />
            )}
            {card.waiting_on && !finished && (
              <WaitingBadge waitingOn={card.waiting_on} highlight={highlight} />
            )}
            {goalTitle && <QuietChip className={chipClip}>{goalTitle}</QuietChip>}
            {boardName && <QuietChip className={chipClip}>{boardName}</QuietChip>}
            {SOURCE_CHIPS[card.source] && <QuietChip>{SOURCE_CHIPS[card.source]}</QuietChip>}
            {shown.map(({ field, text }) => (
              <QuietChip key={field.key} className={chipClip}>
                {field.show_label_on_card !== false && `${field.label}: `}
                {text}
              </QuietChip>
            ))}
          </span>
        </span>
      </button>
    </div>
  );
}

/** A field's answer as the row shows it: a link answer by its cards' titles when known. */
function shownText(
  field: BoardFieldRow,
  value: unknown,
  links: Map<string, LinkSummary> | undefined
): string {
  if (field.kind === 'card_link' && links) {
    const titles = linkedTitles(value, links);
    if (titles.length > 0) return titles.join(', ');
  }
  return formatProperty(field, value);
}
