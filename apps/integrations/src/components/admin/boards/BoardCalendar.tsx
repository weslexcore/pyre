// One board's month. A thin adapter: it holds which month is showing and the
// chips that narrow it, and hands CalendarMonth the entries.
//
// The cards come from BoardView already filtered by the search box and the
// owner select, so narrowing the board narrows the calendar too — which is
// the whole reason this is a view of the board page rather than a page of
// its own.

import { useMemo, useState } from 'react';
import {
  buildCalendar,
  type CalendarEntry,
  monthGridRange,
  monthStartOf,
  movePatch,
} from '@/lib/boards/calendar';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardRow } from '@/lib/db';
import { filterChipClass } from '../scheduleUi';
import { CalendarMonth } from './CalendarMonth';

export interface BoardCalendarProps {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  /** Already narrowed by the board's search and owner filter. */
  cards: BoardCardRow[];
  today: string;
  onOpenCard: (cardId: string) => void;
  /** Dragging an entry to another day; the board's optimistic card save. */
  onMoveCard: (cardId: string, patch: Record<string, unknown>) => void;
}

/**
 * Whether a board has anything to put on a calendar. A board that never
 * opted in should not offer an empty grid, so BoardView hides the pill.
 */
export function boardHasCalendar(board: BoardRow, fields: BoardFieldRow[]): boolean {
  if (board.due_on_calendar) return true;
  return fields.some((field) => field.kind === 'date' && field.show_on_calendar && !field.archived);
}

export function BoardCalendar({
  board,
  columns,
  fields,
  cards,
  today,
  onOpenCard,
  onMoveCard,
}: BoardCalendarProps) {
  const [monthStart, setMonthStart] = useState(() => monthStartOf(today));
  const [hideFinished, setHideFinished] = useState(false);
  // Which of the board's dated things to draw. Empty means everything, the
  // convention the schedule's people filter already set.
  const [only, setOnly] = useState<ReadonlySet<string>>(new Set());

  const dateFields = useMemo(
    () => fields.filter((f) => f.kind === 'date' && f.show_on_calendar && !f.archived),
    [fields]
  );

  const entries = useMemo(() => {
    const { gridStart, gridEnd } = monthGridRange(monthStart);
    return buildCalendar(
      { cards, boards: [board], columns, fields },
      { start: gridStart, end: gridEnd }
    );
  }, [cards, board, columns, fields, monthStart]);

  const shown = useMemo(
    () =>
      entries.filter((entry) => {
        if (hideFinished && entry.finished) return false;
        if (only.size === 0) return true;
        return only.has(sourceOf(entry));
      }),
    [entries, hideFinished, only]
  );

  const toggle = (key: string) =>
    setOnly((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // One source is not a choice, so the chips only appear once there are two.
  const sources = [
    ...(board.due_on_calendar ? [{ key: 'due', label: 'Due dates' }] : []),
    ...dateFields.map((field) => ({ key: `field:${field.key}`, label: field.label })),
  ];

  return (
    <CalendarMonth
      entries={shown}
      monthStart={monthStart}
      onMonthChange={setMonthStart}
      today={today}
      emptyNote={`No ${board.card_noun} on this board is dated this month.`}
      onSelect={(entry) => entry.cardId && onOpenCard(entry.cardId)}
      onMove={(entry, date) => {
        const move = movePatch(entry, date);
        if (move) onMoveCard(move.id, move.patch);
      }}
      chips={
        <>
          {sources.length > 1 &&
            sources.map((source) => (
              <button
                key={source.key}
                type="button"
                className={filterChipClass(only.has(source.key))}
                aria-pressed={only.has(source.key)}
                onClick={() => toggle(source.key)}
              >
                {source.label}
              </button>
            ))}
          <button
            type="button"
            className={filterChipClass(hideFinished)}
            aria-pressed={hideFinished}
            title="Leave out cards that are already done or dropped"
            onClick={() => setHideFinished((value) => !value)}
          >
            Hide finished
          </button>
        </>
      }
    />
  );
}

/** The chip key an entry answers to: its due-ness, or the field it came from. */
function sourceOf(entry: CalendarEntry): string {
  return entry.kind === 'due' ? 'due' : `field:${entry.id.split(':')[2] ?? ''}`;
}
