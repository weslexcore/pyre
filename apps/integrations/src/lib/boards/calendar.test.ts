import { addDays as addDaysBack, weekStartOf } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import type {
  BoardCardRow,
  BoardColumnRow,
  BoardFieldRow,
  BoardFieldValue,
  BoardRow,
  GoalRow,
} from '@/lib/db';
import {
  addMonths,
  buildCalendar,
  type CalendarInput,
  entriesByDate,
  formatEntryTime,
  formatMonth,
  monthEndOf,
  monthGridRange,
  monthStartOf,
  movePatch,
  sundayStartOf,
  weeksOf,
} from './calendar';

// 2026-09-21 is a Monday.
const TODAY = '2026-09-21';

const column = (id: string, kind: BoardColumnRow['kind']): BoardColumnRow =>
  ({
    id,
    board_id: 'leads',
    key: id,
    label: id,
    kind,
    sort_order: 0,
    archived: false,
  }) as BoardColumnRow;

const COLUMNS = [column('new', 'open'), column('booked', 'done'), column('lost', 'dropped')];

const board = (id: string, slug: string, over: Partial<BoardRow> = {}): BoardRow =>
  ({
    id,
    slug,
    name: slug,
    description: '',
    card_noun: 'lead',
    include_in_all_tasks: false,
    due_on_calendar: true,
    goal_id: null,
    section_id: null,
    sort_order: 0,
    archived: false,
    ...over,
  }) as BoardRow;

const field = (
  boardId: string,
  key: string,
  kind: BoardFieldRow['kind'],
  over: Partial<BoardFieldRow> = {}
): BoardFieldRow =>
  ({
    id: `${boardId}-${key}`,
    board_id: boardId,
    key,
    label: key,
    kind,
    options: [],
    hint: null,
    show_on_card: false,
    show_on_calendar: false,
    calendar_time_key: null,
    sort_order: 0,
    archived: false,
    ...over,
  }) as BoardFieldRow;

const card = (
  id: string,
  over: Partial<BoardCardRow> & { properties?: Record<string, BoardFieldValue> } = {}
): BoardCardRow =>
  ({
    id,
    board_id: 'leads',
    column_id: 'new',
    goal_id: null,
    title: id,
    notes_md: '',
    owner_email: null,
    due_date: null,
    waiting_on: null,
    area: null,
    sort_order: 0,
    properties: {},
    source: 'manual',
    external_ref: null,
    completed_at: null,
    completed_by: null,
    created_by: 'w@pyre',
    updated_by: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as BoardCardRow;

const goal = (id: string, over: Partial<GoalRow> = {}): GoalRow =>
  ({
    id,
    parent_id: null,
    title: id,
    description_md: '',
    status: 'active',
    owner_email: null,
    area: null,
    started_at: null,
    target_date: null,
    sort_order: 0,
    completed_at: null,
    completed_by: null,
    completion_note: null,
    ...over,
  }) as GoalRow;

/** The rentals board as the migration seeds it: a dated event, timed. */
const RENTALS = board('leads', 'rentals');
const DATE_FIELD = field('leads', 'requested_date', 'date', {
  label: 'Requested date',
  show_on_calendar: true,
  calendar_time_key: 'requested_time',
});
const TIME_FIELD = field('leads', 'requested_time', 'time', { label: 'Requested time' });

const input = (over: Partial<CalendarInput> = {}): CalendarInput => ({
  cards: [],
  boards: [RENTALS],
  columns: COLUMNS,
  fields: [DATE_FIELD, TIME_FIELD],
  ...over,
});

describe('buildCalendar — date fields', () => {
  it('draws one entry per answered card, with its field label', () => {
    const entries = buildCalendar(
      input({
        cards: [
          card('a', { title: "Sarah's birthday", properties: { requested_date: '2026-10-03' } }),
          card('b', { properties: {} }),
        ],
      })
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'field:a:requested_date',
      date: '2026-10-03',
      kind: 'field',
      label: "Sarah's birthday",
      detail: 'Requested date',
      boardSlug: 'rentals',
      href: '/admin/boards/rentals#card-a',
      finished: false,
    });
  });

  it('ignores an answer that is not a real date', () => {
    const entries = buildCalendar(
      input({ cards: [card('a', { properties: { requested_date: 'next tuesday' } })] })
    );
    expect(entries).toHaveLength(0);
  });

  it('draws nothing for a field that did not opt in', () => {
    const entries = buildCalendar(
      input({
        fields: [field('leads', 'requested_date', 'date')],
        cards: [card('a', { properties: { requested_date: '2026-10-03' } })],
      })
    );
    expect(entries).toHaveLength(0);
  });

  it('ignores an on-calendar flag on a kind that is not a date', () => {
    const entries = buildCalendar(
      input({
        fields: [field('leads', 'occasion', 'text', { show_on_calendar: true })],
        cards: [card('a', { properties: { occasion: '2026-10-03' } })],
      })
    );
    expect(entries).toHaveLength(0);
  });

  it('ignores an archived date field', () => {
    const entries = buildCalendar(
      input({
        fields: [{ ...DATE_FIELD, archived: true }, TIME_FIELD],
        cards: [card('a', { properties: { requested_date: '2026-10-03' } })],
      })
    );
    expect(entries).toHaveLength(0);
  });

  it('draws two entries for a card with two dated fields', () => {
    const setup = field('leads', 'setup_date', 'date', {
      label: 'Setup',
      show_on_calendar: true,
    });
    const entries = buildCalendar(
      input({
        fields: [DATE_FIELD, TIME_FIELD, setup],
        cards: [
          card('a', { properties: { requested_date: '2026-10-03', setup_date: '2026-10-02' } }),
        ],
      })
    );
    expect(entries.map((e) => [e.date, e.detail])).toEqual([
      ['2026-10-02', 'Setup'],
      ['2026-10-03', 'Requested date'],
    ]);
  });
});

describe('buildCalendar — the paired time field', () => {
  it('times an entry from a `time` companion', () => {
    const [entry] = buildCalendar(
      input({
        cards: [
          card('a', { properties: { requested_date: '2026-10-03', requested_time: '18:30' } }),
        ],
      })
    );
    expect(entry).toMatchObject({ time: '18:30', endTime: null, overnight: false });
  });

  it('times an entry from a `time_range` companion', () => {
    const [entry] = buildCalendar(
      input({
        fields: [
          { ...DATE_FIELD, calendar_time_key: 'window' },
          field('leads', 'window', 'time_range'),
        ],
        cards: [
          card('a', { properties: { requested_date: '2026-10-03', window: ['18:00', '21:00'] } }),
        ],
      })
    );
    expect(entry).toMatchObject({ time: '18:00', endTime: '21:00', overnight: false });
  });

  it('keeps a window running past midnight on its start date', () => {
    const [entry] = buildCalendar(
      input({
        fields: [
          { ...DATE_FIELD, calendar_time_key: 'window' },
          field('leads', 'window', 'time_range'),
        ],
        cards: [
          card('a', { properties: { requested_date: '2026-10-03', window: ['21:00', '01:00'] } }),
        ],
      })
    );
    expect(entry).toMatchObject({ date: '2026-10-03', time: '21:00', overnight: true });
  });

  // The four ways a pairing can go nowhere, all landing on all-day rather
  // than on an error: this is the whole reason the reference is not a
  // foreign key.
  it.each([
    ['the companion is gone', [{ ...DATE_FIELD }], { requested_date: '2026-10-03' }],
    [
      'the companion is archived',
      [DATE_FIELD, { ...TIME_FIELD, archived: true }],
      { requested_date: '2026-10-03', requested_time: '18:30' },
    ],
    [
      'the companion is not a time field',
      [DATE_FIELD, field('leads', 'requested_time', 'text')],
      { requested_date: '2026-10-03', requested_time: '18:30' },
    ],
    ['nobody answered it', [DATE_FIELD, TIME_FIELD], { requested_date: '2026-10-03' }],
  ])('falls back to all day when %s', (_why, fields, properties) => {
    const [entry] = buildCalendar(
      input({ fields: fields as BoardFieldRow[], cards: [card('a', { properties })] })
    );
    expect(entry).toMatchObject({ date: '2026-10-03', time: null, endTime: null });
  });
});

describe('buildCalendar — due dates', () => {
  it('draws an all-day entry when the board opted in', () => {
    const [entry] = buildCalendar(input({ cards: [card('a', { due_date: '2026-09-25' })] }));
    expect(entry).toMatchObject({
      id: 'due:a',
      date: '2026-09-25',
      kind: 'due',
      detail: 'Due',
      time: null,
    });
  });

  it('draws nothing when the board turned them off', () => {
    const entries = buildCalendar(
      input({
        boards: [board('leads', 'rentals', { due_on_calendar: false })],
        cards: [card('a', { due_date: '2026-09-25' })],
      })
    );
    expect(entries).toHaveLength(0);
  });

  it('puts a due date and a rental date on their own days', () => {
    const entries = buildCalendar(
      input({
        cards: [
          card('a', {
            title: 'Rental',
            due_date: '2026-09-25',
            properties: { requested_date: '2026-10-09', requested_time: '18:00' },
          }),
        ],
      })
    );
    expect(entries.map((e) => [e.date, e.kind, e.time])).toEqual([
      ['2026-09-25', 'due', null],
      ['2026-10-09', 'field', '18:00'],
    ]);
  });
});

describe('buildCalendar — what counts as finished', () => {
  it.each([
    ['booked', true],
    ['lost', true],
    ['new', false],
  ])('a card in %s is finished: %s', (columnId, finished) => {
    const [entry] = buildCalendar(
      input({ cards: [card('a', { column_id: columnId, due_date: '2026-09-25' })] })
    );
    expect(entry.finished).toBe(finished);
  });

  it('treats a card whose column is gone as open', () => {
    const [entry] = buildCalendar(
      input({ cards: [card('a', { column_id: 'deleted', due_date: '2026-09-25' })] })
    );
    expect(entry.finished).toBe(false);
  });
});

describe('buildCalendar — boards', () => {
  it('draws nothing from an archived board', () => {
    const entries = buildCalendar(
      input({
        boards: [board('leads', 'rentals', { archived: true })],
        cards: [card('a', { due_date: '2026-09-25' })],
      })
    );
    expect(entries).toHaveLength(0);
  });

  it('draws nothing from a board it was not given', () => {
    const entries = buildCalendar(
      input({ cards: [card('a', { board_id: 'other', due_date: '2026-09-25' })] })
    );
    expect(entries).toHaveLength(0);
  });
});

describe('buildCalendar — goals', () => {
  const GOALS = [
    goal('g1', { title: 'Staff run the space', target_date: '2026-10-15' }),
    goal('g2', { title: 'Undated', target_date: null }),
    goal('g3', { title: 'Met', target_date: '2026-10-16', status: 'completed' }),
  ];

  it('leaves them out unless asked for', () => {
    expect(buildCalendar(input({ goals: GOALS }))).toHaveLength(0);
  });

  it('draws the dated ones, flagging the closed', () => {
    const entries = buildCalendar(input({ goals: GOALS }), { includeGoals: true });
    expect(entries.map((e) => [e.label, e.finished])).toEqual([
      ['Staff run the space', false],
      ['Met', true],
    ]);
    expect(entries[0]).toMatchObject({ kind: 'goal', detail: 'Target date', time: null });
  });

  it('links through the board that serves it, and to the overview otherwise', () => {
    const entries = buildCalendar(
      input({ boards: [board('leads', 'rentals', { goal_id: 'g1' })], goals: GOALS }),
      { includeGoals: true }
    );
    expect(entries[0].href).toBe('/admin/boards/rentals');
    expect(entries[1].href).toBe('/admin/boards/all-goals');
  });
});

describe('buildCalendar — order and window', () => {
  const CARDS = [
    card('late', { properties: { requested_date: '2026-10-03', requested_time: '21:00' } }),
    card('early', { properties: { requested_date: '2026-10-03', requested_time: '09:00' } }),
    card('allday', { due_date: '2026-10-03' }),
  ];

  it('puts timed entries first, ascending, then the all-day ones', () => {
    const entries = buildCalendar(input({ cards: CARDS }));
    expect(entries.map((e) => e.id)).toEqual([
      'field:early:requested_date',
      'field:late:requested_date',
      'due:allday',
    ]);
  });

  it('is stable across two builds of the same rows', () => {
    const once = buildCalendar(input({ cards: CARDS })).map((e) => e.id);
    const twice = buildCalendar(input({ cards: CARDS })).map((e) => e.id);
    expect(once).toEqual(twice);
    expect(new Set(once).size).toBe(once.length);
  });

  it('clips to the window, inclusive at both ends', () => {
    const cards = ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'].map((date, i) =>
      card(`c${i}`, { due_date: date })
    );
    const entries = buildCalendar(input({ cards }), { start: '2026-10-01', end: '2026-10-31' });
    expect(entries.map((e) => e.date)).toEqual(['2026-10-01', '2026-10-31']);
  });
});

describe('movePatch — dragging an entry onto another day', () => {
  const entriesFor = (over = {}) =>
    buildCalendar(
      input({
        cards: [
          card('a', {
            due_date: '2026-09-25',
            properties: { requested_date: '2026-10-09', requested_time: '18:00' },
            ...over,
          }),
        ],
      })
    );

  it('moves a due date', () => {
    const due = entriesFor().find((e) => e.kind === 'due');
    expect(movePatch(due as never, '2026-09-28')).toEqual({
      id: 'a',
      patch: { dueDate: '2026-09-28' },
    });
  });

  // Naming one key leaves the rest of the card alone — the route merges
  // against what is stored — so the requested time survives its date moving.
  it('moves a date field by naming only its key', () => {
    const field = entriesFor().find((e) => e.kind === 'field');
    expect(field?.fieldKey).toBe('requested_date');
    expect(movePatch(field as never, '2026-10-10')).toEqual({
      id: 'a',
      patch: { properties: { requested_date: '2026-10-10' } },
    });
  });

  it('refuses to move a goal, which is not a card', () => {
    const [entry] = buildCalendar(input({ goals: [goal('g1', { target_date: '2026-10-15' })] }), {
      includeGoals: true,
    });
    expect(movePatch(entry, '2026-10-16')).toBeNull();
  });
});

describe('entriesByDate', () => {
  it('buckets by day, keeping each day in order', () => {
    const entries = buildCalendar(
      input({
        cards: [
          card('a', { due_date: '2026-10-03' }),
          card('b', { properties: { requested_date: '2026-10-03', requested_time: '09:00' } }),
          card('c', { due_date: '2026-10-04' }),
        ],
      })
    );
    const byDate = entriesByDate(entries);
    expect([...byDate.keys()]).toEqual(['2026-10-03', '2026-10-04']);
    expect(byDate.get('2026-10-03')?.map((e) => e.id)).toEqual(['field:b:requested_date', 'due:a']);
  });
});

describe('formatEntryTime', () => {
  const at = (time: string | null, endTime: string | null = null) =>
    formatEntryTime({ time, endTime } as never);

  it.each([
    [null, null, ''],
    ['18:30', null, '6:30p'],
    ['18:00', null, '6p'],
    ['18:00', '21:00', '6–9p'],
    ['11:00', '13:00', '11a–1p'],
    ['21:00', '01:00', '9p–1a'],
  ])('%s–%s reads as %s', (time, endTime, expected) => {
    expect(at(time, endTime)).toBe(expected);
  });
});

describe('month arithmetic', () => {
  it('finds the start of a month', () => {
    expect(monthStartOf(TODAY)).toBe('2026-09-01');
  });

  it('steps across a year boundary in both directions', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2026-09-01', 0)).toBe('2026-09-01');
  });

  it('knows how long February is', () => {
    expect(monthEndOf('2026-02-01')).toBe('2026-02-28');
    expect(monthEndOf('2028-02-01')).toBe('2028-02-29');
    expect(monthEndOf('2026-09-01')).toBe('2026-09-30');
  });

  it('finds the Sunday of a week, and leaves a Sunday alone', () => {
    expect(sundayStartOf('2026-09-23')).toBe('2026-09-20'); // a Wednesday
    expect(sundayStartOf('2026-09-20')).toBe('2026-09-20'); // already Sunday
    expect(sundayStartOf('2026-09-26')).toBe('2026-09-20'); // a Saturday
  });

  it('runs the grid from the Sunday on or before the 1st', () => {
    // 1 Sep 2026 is a Tuesday; 30 Sep is a Wednesday.
    expect(monthGridRange('2026-09-01')).toEqual({
      gridStart: '2026-08-30',
      gridEnd: '2026-10-03',
    });
  });

  it('starts every grid on a Sunday and ends it on a Saturday', () => {
    for (const month of ['2026-02-01', '2026-03-01', '2026-11-01', '2027-08-01']) {
      const { gridStart, gridEnd } = monthGridRange(month);
      expect(sundayStartOf(gridStart)).toBe(gridStart);
      expect(sundayStartOf(gridEnd)).toBe(addDaysBack(gridEnd, -6));
      expect(gridStart <= month).toBe(true);
      expect(gridEnd >= monthEndOf(month)).toBe(true);
    }
  });

  it('splits the grid into whole weeks', () => {
    const { gridStart, gridEnd } = monthGridRange('2026-09-01');
    const weeks = weeksOf(gridStart, gridEnd);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe(gridStart);
    expect(weeks[4][6]).toBe(gridEnd);
  });

  it('leaves schedule-core alone: the staff week still starts on Monday', () => {
    // The schedule locks Monday–Sunday weeks and rolls hours up the same
    // way, so the calendar carries its own week start rather than moving it.
    expect(weekStartOf('2026-09-23')).toBe('2026-09-21');
  });

  it('names the month', () => {
    expect(formatMonth('2026-09-01')).toBe('September 2026');
  });
});
