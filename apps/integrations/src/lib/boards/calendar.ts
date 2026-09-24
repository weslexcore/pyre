// The boards calendar: every dated thing on a board, as entries on a month.
//
// A card routinely holds two dates that mean different things. A rental lead
// is chased two weeks out (due_date) and happens on the day itself
// (properties.requested_date). Until now neither could be seen against the
// other, or against the rest of the month. So a board says which of its date
// fields are events (board_fields.show_on_calendar), which time field goes
// with each one (calendar_time_key), and whether due dates show at all
// (boards.due_on_calendar) — and this turns that configuration plus the rows
// into a flat list of entries.
//
// Pure and client-safe, the shape lib/goals/allTasks.ts set: the route hands
// over rows, this builds the view, the island renders it. That is also what
// lets the per-board calendar run off the bundle BoardView already has.
//
// It is deliberately forgiving. A pointer at a field that has since been
// archived, a time field nobody answered, a date typed into a text box — all
// of it degrades to an all-day entry or to nothing at all, never to a throw.
// The calendar is the last place a stale configuration should show up as an
// error page.

import { addDays } from '@pyre/schedule-core';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardRow, GoalRow } from '@/lib/db';
import { goalOverviewHref, isClosedStatus } from '@/lib/goals/types';
import { isYmd } from '@/lib/goals/validate';
import { isFinishedKind, kindIsTime } from './types';

/** Why an entry is on the day it is on. */
export type CalendarEntryKind = 'due' | 'field' | 'goal';

export interface CalendarEntry {
  /** Stable across builds of the same input: the React key and the dedupe id. */
  id: string;
  /** YYYY-MM-DD, venue-local — the day the entry draws on. */
  date: string;
  /** 'HH:MM' when a companion time field answered; null for an all-day entry. */
  time: string | null;
  /** The far end of a time_range; null for a moment or an all-day entry. */
  endTime: string | null;
  kind: CalendarEntryKind;
  /** What a person reads: the card's title, or the goal's. */
  label: string;
  /** Why it is here: the field's label, 'Due', 'Target date'. */
  detail: string;
  cardId?: string;
  /** The date field this entry came from — what a drag to another day writes. */
  fieldKey?: string;
  /** All options, including ones outside the visible month, for moving one date. */
  fieldDates?: string[];
  goalId?: string;
  boardId?: string;
  boardSlug?: string;
  boardName?: string;
  /** A finished card or a closed goal. Drawn muted; hideable with a chip. */
  finished: boolean;
  /** Where clicking goes, following the #card-<id> deep-link convention. */
  href: string;
  /** A time_range that ends before it starts — a party running past midnight. */
  overnight: boolean;
}

export interface CalendarInput {
  cards: BoardCardRow[];
  boards: BoardRow[];
  columns: Pick<BoardColumnRow, 'id' | 'kind'>[];
  fields: BoardFieldRow[];
  goals?: GoalRow[];
}

export interface CalendarOptions {
  /** Inclusive window; entries outside it are dropped. Omit for everything. */
  start?: string;
  end?: string;
  /** Goal target dates. The cross-board view wants them; one board does not. */
  includeGoals?: boolean;
}

/** Venue-local wall-clock time, as normalizeAnswer stores it. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeOf(value: unknown): string | null {
  return typeof value === 'string' && TIME_RE.test(value) ? value : null;
}

/** A card's answer to a date field, or null when there isn't a usable one. */
function dateOf(value: unknown): string | null {
  return typeof value === 'string' && isYmd(value) ? value : null;
}

interface Timing {
  time: string | null;
  endTime: string | null;
  overnight: boolean;
}

const ALL_DAY: Timing = { time: null, endTime: null, overnight: false };

/**
 * The moment or window a date entry sits at, read from the companion field
 * the date field names. Every way this can fail — no pointer, a pointer at a
 * field that is gone or archived or of the wrong kind, an unanswered or
 * malformed answer — lands on the same all-day result, because a rental
 * whose time nobody has agreed yet is still on that day.
 */
function timingFor(
  field: BoardFieldRow,
  card: BoardCardRow,
  timeFields: Map<string, BoardFieldRow>
): Timing {
  if (field.calendar_time_key === null) return ALL_DAY;
  const companion = timeFields.get(field.calendar_time_key);
  if (!companion) return ALL_DAY;

  const answer = card.properties[companion.key];
  if (companion.kind === 'time') {
    const time = timeOf(answer);
    return time ? { time, endTime: null, overnight: false } : ALL_DAY;
  }

  // time_range: both ends or nothing, the way normalizeAnswer stores it.
  if (!Array.isArray(answer) || answer.length !== 2) return ALL_DAY;
  const start = timeOf(answer[0]);
  const end = timeOf(answer[1]);
  if (!start || !end) return ALL_DAY;
  // An end before a start is a window running past midnight, which
  // validate.ts allows on purpose. The entry stays on its start date and
  // sorts by its start; splitting it across two cells would say the rental
  // happens twice.
  return { time: start, endTime: end, overnight: end < start };
}

/**
 * What moving an entry to another day writes: the card's due date, or the
 * answer to the field the entry came from. A goal's target date is not a
 * card patch, so it cannot be dragged — null says so.
 */
export function movePatch(
  entry: CalendarEntry,
  date: string
): { id: string; patch: Record<string, unknown> } | null {
  if (!entry.cardId) return null;
  if (entry.kind === 'due') return { id: entry.cardId, patch: { dueDate: date } };
  if (entry.kind === 'field' && entry.fieldKey) {
    // properties is merged server-side against the card's current answers
    // (normalizeProperties), so naming one key leaves the rest alone — the
    // requested time survives its date moving.
    const answer = entry.fieldDates
      ? [...new Set(entry.fieldDates.map((option) => (option === entry.date ? date : option)))]
      : date;
    return { id: entry.cardId, patch: { properties: { [entry.fieldKey]: answer } } };
  }
  return null;
}

/** The deep link that opens a card wherever it lives. */
export function cardHref(slug: string, cardId: string): string {
  return `/admin/boards/${slug}#card-${cardId}`;
}

function withinWindow(date: string, start?: string, end?: string): boolean {
  if (start !== undefined && date < start) return false;
  if (end !== undefined && date > end) return false;
  return true;
}

// The board's position, carried only while sorting so equal-timed entries
// from different boards land in the order the index lists them.
interface Sortable extends CalendarEntry {
  sortKey: number;
}

/**
 * Timed entries first, ascending, then the all-day ones. The appointments are
 * what this calendar is scanned for — when is the rental — and the due dates
 * and goal targets are the background it reads against. The tie-breaks run
 * all the way down to the id so two builds of the same rows can never come
 * back in a different order.
 */
function compareEntries(a: Sortable, b: Sortable): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
  if (a.time !== null && b.time !== null && a.time !== b.time) {
    return a.time.localeCompare(b.time);
  }
  if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
  return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

/**
 * Every dated thing the given rows describe, sorted, and clipped to the
 * window when one is given.
 */
export function buildCalendar(
  input: CalendarInput,
  options: CalendarOptions = {}
): CalendarEntry[] {
  const { start, end, includeGoals = false } = options;
  const { cards, boards, columns, fields, goals = [] } = input;

  // An archived board is off the index; its cards are off the calendar too.
  const boardsById = new Map(boards.filter((board) => !board.archived).map((b) => [b.id, b]));
  const boardOrder = new Map([...boardsById.keys()].map((id, index) => [id, index]));
  const columnsById = new Map(columns.map((column) => [column.id, column]));

  // Per board: the date fields that are events, and every field that could
  // time one. Archived fields draw nothing and time nothing.
  const dateFields = new Map<string, BoardFieldRow[]>();
  const timeFields = new Map<string, Map<string, BoardFieldRow>>();
  for (const field of fields) {
    if (field.archived || !boardsById.has(field.board_id)) continue;
    if (field.kind === 'date' && field.show_on_calendar) {
      const list = dateFields.get(field.board_id);
      if (list) list.push(field);
      else dateFields.set(field.board_id, [field]);
    }
    if (kindIsTime(field.kind)) {
      const map = timeFields.get(field.board_id);
      if (map) map.set(field.key, field);
      else timeFields.set(field.board_id, new Map([[field.key, field]]));
    }
  }

  const entries: Sortable[] = [];

  for (const card of cards) {
    const board = boardsById.get(card.board_id);
    if (!board) continue;
    // A card whose column has gone missing counts as open, the same call
    // buildAllTasks makes: work that cannot be proven finished stays loud.
    const kind = columnsById.get(card.column_id)?.kind;
    const finished = kind !== undefined && isFinishedKind(kind);
    const sortKey = boardOrder.get(board.id) ?? 0;
    const href = cardHref(board.slug, card.id);
    const shared = {
      cardId: card.id,
      boardId: board.id,
      boardSlug: board.slug,
      boardName: board.name,
      label: card.title,
      finished,
      href,
      sortKey,
    };

    if (board.due_on_calendar && card.due_date !== null) {
      entries.push({
        id: `due:${card.id}`,
        date: card.due_date,
        ...ALL_DAY,
        kind: 'due',
        detail: 'Due',
        ...shared,
      });
    }

    const companions = timeFields.get(board.id) ?? new Map<string, BoardFieldRow>();
    for (const field of dateFields.get(board.id) ?? []) {
      const answer = card.properties[field.key];
      const dates = [
        ...new Set(
          (Array.isArray(answer) ? answer : [answer])
            .map(dateOf)
            .filter((date): date is string => date !== null)
        ),
      ];
      for (const date of dates) {
        entries.push({
          id: `field:${card.id}:${field.key}${Array.isArray(answer) ? `:${date}` : ''}`,
          date,
          ...timingFor(field, card, companions),
          kind: 'field',
          detail: field.label,
          fieldKey: field.key,
          ...(Array.isArray(answer) ? { fieldDates: dates } : {}),
          ...shared,
        });
      }
    }
  }

  if (includeGoals) {
    // A goal is reached from the board that serves it; one that no board
    // serves is the overview's.
    const boardForGoal = new Map<string, BoardRow>();
    for (const board of boardsById.values()) {
      if (board.goal_id && !boardForGoal.has(board.goal_id)) boardForGoal.set(board.goal_id, board);
    }
    for (const goal of goals) {
      if (goal.target_date === null) continue;
      const board = boardForGoal.get(goal.id);
      entries.push({
        id: `goal:${goal.id}`,
        date: goal.target_date,
        ...ALL_DAY,
        kind: 'goal',
        label: goal.title,
        detail: 'Target date',
        goalId: goal.id,
        boardId: board?.id,
        boardSlug: board?.slug,
        boardName: board?.name,
        finished: isClosedStatus(goal.status),
        href: board ? `/admin/boards/${board.slug}` : goalOverviewHref(goal.id),
        // Goals sort after every board, so a target date reads as the
        // horizon behind the day's work rather than a line of it.
        sortKey: boardsById.size,
      });
    }
  }

  return entries
    .filter((entry) => withinWindow(entry.date, start, end))
    .sort(compareEntries)
    .map(({ sortKey: _sortKey, ...entry }) => entry);
}

/** Entries under their date, each day already in order. */
export function entriesByDate(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const byDate = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const day = byDate.get(entry.date);
    if (day) day.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  return byDate;
}

/** '6:30p', '6–9p', '' — the compact label a month cell has room for. */
export function formatEntryTime(entry: CalendarEntry): string {
  if (entry.time === null) return '';
  const start = shortTime(entry.time);
  if (entry.endTime === null) return start;
  // The suffix is dropped from the start when both ends share it: 6–9p, but
  // 11a–1p.
  const end = shortTime(entry.endTime);
  const sameHalf = start.slice(-1) === end.slice(-1);
  return `${sameHalf ? start.slice(0, -1) : start}–${end}`;
}

/** '18:30' as '6:30p'; '18:00' as '6p'. */
export function shortTime(value: string): string {
  const [hour, minute] = value.split(':');
  const hours = Number(hour);
  const suffix = hours < 12 ? 'a' : 'p';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minute === '00' ? `${hour12}${suffix}` : `${hour12}:${minute}${suffix}`;
}

// ---------------------------------------------------------------------------
// Month arithmetic.
//
// ScheduleCalendar keeps its own copies of these, privately and untested.
// They live here so both new calendars share one implementation with a test
// around it; that component is deliberately left alone, since changing it
// would mean re-verifying a page this work does not touch.

/** First day of the month containing a YYYY-MM-DD date. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(monthStart: string, delta: number): string {
  const [year, month] = monthStart.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** Last day of the month, as YYYY-MM-DD. */
export function monthEndOf(monthStart: string): string {
  return addDays(addMonths(monthStart, 1), -1);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatMonth(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Sunday of the week containing a date.
 *
 * Deliberately not schedule-core's weekStartOf, which is Monday: the staff
 * schedule's weeks lock Monday–Sunday and its hours report rolls up the same
 * way, so that function means something there and cannot move. A calendar is
 * read differently — a weekend reads as a weekend when it sits at the two
 * ends of a row rather than split across two.
 */
export function sundayStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -day);
}

/** The Sunday on or before the 1st, through the Saturday on or after the last. */
export function monthGridRange(monthStart: string): { gridStart: string; gridEnd: string } {
  return {
    gridStart: sundayStartOf(monthStart),
    gridEnd: addDays(sundayStartOf(monthEndOf(monthStart)), 6),
  };
}

/** The grid as weeks of seven days. */
export function weeksOf(gridStart: string, gridEnd: string): string[][] {
  const weeks: string[][] = [];
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}
