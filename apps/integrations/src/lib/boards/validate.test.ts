import { describe, expect, it } from 'vitest';
import type { BoardFieldRow } from '@/lib/db';
import {
  formatProperty,
  normalizeProperties,
  parseBoardCreate,
  parseBoardPatch,
  parseCardCreate,
  parseCardPatch,
} from './validate';

const UUID = '3f1b8a2c-7d4e-4a1b-9c2d-5e6f7a8b9c0d';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}
function error(result: { ok: boolean; error?: string }): string {
  if (result.ok) throw new Error('expected a failure');
  return result.error ?? '';
}

const columns = [
  { key: 'new', label: 'New', kind: 'open' },
  { key: 'booked', label: 'Booked', kind: 'done' },
];

describe('parseBoardCreate', () => {
  it('takes a board with its columns', () => {
    const board = value(parseBoardCreate({ name: 'Rental leads', slug: 'rentals', columns }));
    expect(board).toMatchObject({
      slug: 'rentals',
      name: 'Rental leads',
      card_noun: 'task',
      include_in_all_tasks: true,
    });
    expect(board.columns.map((c) => c.sort_order)).toEqual([10, 20]);
  });

  it('insists on a slug the constraint would accept, lowercasing on the way', () => {
    expect(value(parseBoardCreate({ name: 'X', slug: ' Rentals ', columns })).slug).toBe('rentals');
    expect(error(parseBoardCreate({ name: 'X', slug: '1rentals', columns }))).toMatch(/slug/);
    expect(error(parseBoardCreate({ name: 'X', slug: 'a', columns }))).toMatch(/slug/);
    expect(error(parseBoardCreate({ name: 'X', slug: 'a b', columns }))).toMatch(/slug/);
  });

  it('insists on at least one open column', () => {
    const closed = [{ key: 'booked', label: 'Booked', kind: 'done' }];
    expect(error(parseBoardCreate({ name: 'X', slug: 'x-board', columns: closed }))).toMatch(
      /open column/
    );
    expect(error(parseBoardCreate({ name: 'X', slug: 'x-board', columns: [] }))).toMatch(
      /non-empty/
    );
  });

  it('rejects duplicate and malformed column keys', () => {
    const dupes = [...columns, { key: 'new', label: 'Again', kind: 'open' }];
    expect(error(parseBoardCreate({ name: 'X', slug: 'x-board', columns: dupes }))).toMatch(
      /Duplicate/
    );
    const bad = [{ key: 'New Column', label: 'X', kind: 'open' }];
    expect(error(parseBoardCreate({ name: 'X', slug: 'x-board', columns: bad }))).toMatch(
      /lowercase/
    );
  });

  it('rejects a column kind nobody has', () => {
    const bad = [{ key: 'waiting', label: 'Waiting', kind: 'blocked' }];
    expect(error(parseBoardCreate({ name: 'X', slug: 'x-board', columns: bad }))).toMatch(
      /open, done, or dropped/
    );
  });

  it('takes a goal to serve, by id or as a goal to create, never both', () => {
    expect(
      value(parseBoardCreate({ name: 'X', slug: 'x-board', columns, goalId: UUID }))
    ).toMatchObject({ goal_id: UUID, goal: null });
    const created = value(
      parseBoardCreate({
        name: 'X',
        slug: 'x-board',
        columns,
        goal: { title: 'Ten rentals by December', targetDate: '2026-12-31' },
      })
    );
    expect(created.goal_id).toBeNull();
    expect(created.goal).toMatchObject({ title: 'Ten rentals by December', status: 'planned' });
    expect(
      error(parseBoardCreate({ name: 'X', slug: 'x-board', columns, goalId: UUID, goal: {} }))
    ).toMatch(/not both/);
    expect(error(parseBoardCreate({ name: 'X', slug: 'x-board', columns, goal: {} }))).toMatch(
      /goal: title/
    );
    expect(
      value(parseBoardCreate({ name: 'X', slug: 'x-board', columns, goalId: '' }))
    ).toMatchObject({ goal_id: null, goal: null });
  });

  it("keeps the tool's own pages out of the slug space", () => {
    expect(error(parseBoardCreate({ name: 'X', slug: 'tasks', columns }))).toMatch(/page/);
  });

  it('takes include_in_all_tasks false explicitly', () => {
    const board = value(
      parseBoardCreate({ name: 'X', slug: 'x-board', columns, includeInAllTasks: false })
    );
    expect(board.include_in_all_tasks).toBe(false);
  });
});

describe('parseBoardPatch', () => {
  it('touches only what was sent', () => {
    expect(value(parseBoardPatch({ name: 'Renamed' }))).toEqual({ name: 'Renamed' });
    expect(error(parseBoardPatch({}))).toMatch(/Nothing to change/);
  });

  it('replaces the whole column list when one is sent', () => {
    expect(value(parseBoardPatch({ columns })).columns).toHaveLength(2);
  });

  it('replaces the whole field list when one is sent', () => {
    const fields = value(
      parseBoardPatch({
        fields: [
          { key: 'party_size', label: 'Party size', kind: 'number', showOnCard: true },
          {
            key: 'occasion',
            label: 'Occasion',
            kind: 'choice',
            options: 'Birthday, Team, , birthday',
          },
        ],
      })
    ).fields;
    expect(fields).toHaveLength(2);
    expect(fields?.[0]).toMatchObject({
      key: 'party_size',
      show_on_card: true,
      // Nothing is an event until a board says so.
      show_on_calendar: false,
      calendar_time_key: null,
      sort_order: 10,
      options: [],
    });
    expect(fields?.[1]).toMatchObject({
      options: ['Birthday', 'Team'],
      sort_order: 20,
      hint: null,
    });
  });

  it('insists a pick field has something to pick between', () => {
    const one = [{ key: 'occasion', label: 'Occasion', kind: 'choice', options: ['Only'] }];
    expect(error(parseBoardPatch({ fields: one }))).toMatch(/two options/);
    const dupes = [
      { key: 'note', label: 'A', kind: 'text' },
      { key: 'note', label: 'B', kind: 'text' },
    ];
    expect(error(parseBoardPatch({ fields: dupes }))).toMatch(/Duplicate/);
    expect(
      error(parseBoardPatch({ fields: [{ key: 'note', label: 'A', kind: 'rating' }] }))
    ).toMatch(/kind/);
    expect(value(parseBoardPatch({ fields: [] })).fields).toEqual([]);
  });

  it('attaches or detaches a goal', () => {
    expect(value(parseBoardPatch({ goalId: UUID })).goal_id).toBe(UUID);
    expect(value(parseBoardPatch({ goalId: null })).goal_id).toBeNull();
    expect(value(parseBoardPatch({ goalId: '' })).goal_id).toBeNull();
    expect('goal_id' in value(parseBoardPatch({ name: 'a' }))).toBe(false);
    expect(error(parseBoardPatch({ goalId: 'nope' }))).toMatch(/goalId/);
  });

  it('still refuses a column list with no open column', () => {
    const closed = [{ key: 'booked', label: 'Booked', kind: 'done' }];
    expect(error(parseBoardPatch({ columns: closed }))).toMatch(/open column/);
  });

  it('lets an archived column stay in the list without counting as open', () => {
    const archived = [
      { key: 'old', label: 'Old', kind: 'open', archived: true },
      { key: 'booked', label: 'Booked', kind: 'done' },
    ];
    expect(error(parseBoardPatch({ columns: archived }))).toMatch(/open column/);
  });
});

describe('parseCardCreate', () => {
  it('takes a bare title', () => {
    expect(value(parseCardCreate({ title: '  Call the caterer  ' }))).toMatchObject({
      title: 'Call the caterer',
      column_id: null,
      owner_email: null,
      due_date: null,
    });
  });

  it('takes the whole shape', () => {
    expect(
      value(
        parseCardCreate({
          title: 'Call the caterer',
          columnId: UUID,
          ownerEmail: ' Maya@PyreSauna.com ',
          dueDate: '2026-10-01',
          waitingOn: 'their callback',
          area: 'Events',
        })
      )
    ).toMatchObject({
      column_id: UUID,
      owner_email: 'maya@pyresauna.com',
      due_date: '2026-10-01',
      waiting_on: 'their callback',
      area: 'Events',
    });
  });

  it('rejects a blank title and a bad date', () => {
    expect(error(parseCardCreate({ title: '   ' }))).toMatch(/title/);
    expect(error(parseCardCreate({ title: 'a', dueDate: '2026-02-30' }))).toMatch(/dueDate/);
  });

  it("never takes a goal: a card is filed under its board's goal", () => {
    expect('goal_id' in value(parseCardCreate({ title: 'a', goalId: UUID }))).toBe(false);
    expect('goal_id' in value(parseCardPatch({ title: 'a', goalId: UUID }))).toBe(false);
  });
});

describe('parseCardPatch', () => {
  it('tells null apart from absent', () => {
    expect('due_date' in value(parseCardPatch({ title: 'a' }))).toBe(false);
    expect(value(parseCardPatch({ dueDate: null })).due_date).toBeNull();
    expect(value(parseCardPatch({ dueDate: '' })).due_date).toBeNull();
    expect(value(parseCardPatch({ waitingOn: null })).waiting_on).toBeNull();
  });

  it('accepts a properties-only patch', () => {
    const patch = parseCardPatch({ properties: { party_size: 8 } });
    expect(patch.ok).toBe(true);
    expect(error(parseCardPatch({}))).toMatch(/Nothing to change/);
    expect(error(parseCardPatch({ properties: [] }))).toMatch(/properties/);
  });
});

const field = (over: Partial<BoardFieldRow>): BoardFieldRow =>
  ({ key: 'x', label: 'X', kind: 'text', options: [], ...over }) as BoardFieldRow;

const FIELDS = [
  field({ key: 'contact_name', kind: 'text' }),
  field({ key: 'party_size', kind: 'number' }),
  field({ key: 'requested_date', kind: 'date' }),
  field({ key: 'requested_time', kind: 'time' }),
  field({ key: 'requested_window', kind: 'time_range' }),
  field({ key: 'deposit_paid', kind: 'yes_no' }),
  field({ key: 'occasion', kind: 'choice', options: ['Birthday', 'Offsite'] }),
  field({ key: 'extras', kind: 'multi_choice', options: ['Tea', 'Towels'] }),
];

describe('normalizeProperties', () => {
  it('coerces each kind to what it stores', () => {
    expect(
      normalizeProperties(FIELDS, {
        contact_name: '  Dana  ',
        party_size: '8',
        requested_date: '2026-10-03',
        deposit_paid: 'true',
        occasion: 'Birthday',
        extras: ['Tea', 'Tea', 'Towels'],
      })
    ).toEqual({
      contact_name: 'Dana',
      party_size: 8,
      requested_date: '2026-10-03',
      deposit_paid: true,
      occasion: 'Birthday',
      extras: ['Tea', 'Towels'],
    });
  });

  it('drops keys the board does not have', () => {
    expect(normalizeProperties(FIELDS, { nonsense: 'x', contact_name: 'Dana' })).toEqual({
      contact_name: 'Dana',
    });
  });

  it('clears an answer that is no longer usable rather than storing half of it', () => {
    const previous = { party_size: 8, occasion: 'Birthday' };
    expect(normalizeProperties(FIELDS, { party_size: 'lots' }, previous)).toEqual({
      occasion: 'Birthday',
    });
    expect(normalizeProperties(FIELDS, { occasion: 'Wedding' }, previous)).toEqual({
      party_size: 8,
    });
    expect(normalizeProperties(FIELDS, { requested_date: '2026-02-31' })).toEqual({});
  });

  it('leaves untouched keys alone on a partial patch', () => {
    const previous = { contact_name: 'Dana', party_size: 8 };
    expect(normalizeProperties(FIELDS, { party_size: 10 }, previous)).toEqual({
      contact_name: 'Dana',
      party_size: 10,
    });
  });

  it('clears a key sent as null', () => {
    expect(normalizeProperties(FIELDS, { party_size: null }, { party_size: 8 })).toEqual({});
  });

  it('ignores a body that is not an object', () => {
    expect(normalizeProperties(FIELDS, ['nope'], { party_size: 8 })).toEqual({ party_size: 8 });
    expect(normalizeProperties(FIELDS, null, { party_size: 8 })).toEqual({ party_size: 8 });
  });
});

describe('formatProperty', () => {
  it('reads an answer back as words', () => {
    expect(formatProperty({ kind: 'yes_no' }, true)).toBe('Yes');
    expect(formatProperty({ kind: 'yes_no' }, false)).toBe('No');
    expect(formatProperty({ kind: 'multi_choice' }, ['Tea', 'Towels'])).toBe('Tea, Towels');
    expect(formatProperty({ kind: 'number' }, 8)).toBe('8');
    expect(formatProperty({ kind: 'text' }, 'Dana')).toBe('Dana');
    expect(formatProperty({ kind: 'text' }, null)).toBe('');
  });
});

describe('rental requested time', () => {
  it('accepts time field definitions', () => {
    expect(
      value(
        parseBoardPatch({
          fields: [
            { key: 'requested_time', label: 'Requested time', kind: 'time', showOnCard: true },
          ],
        })
      ).fields?.[0].kind
    ).toBe('time');
  });

  it.each(['00:00', '12:00', '18:30', '23:59'])(
    'saves %s without altering the requested date',
    (time) => {
      expect(
        normalizeProperties(FIELDS, { requested_time: time }, { requested_date: '2026-10-03' })
      ).toEqual({ requested_date: '2026-10-03', requested_time: time });
    }
  );

  it.each(['24:00', '12:60', '9:30', 'noon', '2026-10-03T18:30', 123])(
    'rejects invalid time %s',
    (time) => {
      expect(normalizeProperties(FIELDS, { requested_time: time })).toEqual({});
    }
  );

  it('clears the time while preserving the date', () => {
    expect(
      normalizeProperties(
        FIELDS,
        { requested_time: null },
        { requested_date: '2026-10-03', requested_time: '18:30' }
      )
    ).toEqual({ requested_date: '2026-10-03' });
  });

  it.each([
    ['00:00', '12:00 AM'],
    ['12:00', '12:00 PM'],
    ['18:30', '6:30 PM'],
  ])('formats %s for card display', (time, expected) => {
    expect(formatProperty({ kind: 'time' }, time)).toBe(expected);
  });
});

describe('time range fields', () => {
  it('accepts time_range field definitions', () => {
    expect(
      value(
        parseBoardPatch({
          fields: [{ key: 'requested_window', label: 'Requested window', kind: 'time_range' }],
        })
      ).fields?.[0].kind
    ).toBe('time_range');
  });

  it('stores a complete pair, trimmed', () => {
    expect(normalizeProperties(FIELDS, { requested_window: [' 18:30', '21:00 '] })).toEqual({
      requested_window: ['18:30', '21:00'],
    });
  });

  it('keeps a window that runs past midnight', () => {
    expect(normalizeProperties(FIELDS, { requested_window: ['21:00', '01:00'] })).toEqual({
      requested_window: ['21:00', '01:00'],
    });
  });

  it.each([
    ['one end only', ['18:30']],
    ['a blank end', ['18:30', '']],
    ['three parts', ['18:30', '19:00', '21:00']],
    ['a bad time', ['18:30', '25:00']],
    ['a string', '18:30-21:00'],
    ['an object', { start: '18:30', end: '21:00' }],
  ])('drops %s', (_, raw) => {
    expect(
      normalizeProperties(
        FIELDS,
        { requested_window: raw },
        { requested_window: ['09:00', '10:00'] }
      )
    ).toEqual({});
  });

  it('formats a window for the card and nothing for a broken one', () => {
    expect(formatProperty({ kind: 'time_range' }, ['18:30', '21:00'])).toBe('6:30 PM – 9:00 PM');
    expect(formatProperty({ kind: 'time_range' }, ['18:30'])).toBe('');
    expect(formatProperty({ kind: 'time_range' }, '18:30')).toBe('');
  });
});

describe('reserved slugs', () => {
  it.each(['tasks', 'all-goals', 'calendar', 'new'])(
    'refuses %s, so no board can shadow a page of the tool',
    (slug) => {
      expect(error(parseBoardCreate({ name: 'Nope', slug, columns }))).toMatch(
        /is a page of the tool/
      );
    }
  );
});

describe('calendar fields', () => {
  const fieldsOf = (fields: unknown[]) => value(parseBoardPatch({ fields })).fields;

  const DATE = { key: 'requested_date', label: 'Requested date', kind: 'date' };
  const TIME = { key: 'requested_time', label: 'Requested time', kind: 'time' };

  it('puts a date field on the calendar, timed by a time field', () => {
    const fields = fieldsOf([
      { ...DATE, showOnCalendar: true, calendarTimeKey: 'requested_time' },
      TIME,
    ]);
    expect(fields?.[0]).toMatchObject({
      show_on_calendar: true,
      calendar_time_key: 'requested_time',
    });
  });

  it('accepts a time range as the companion', () => {
    const fields = fieldsOf([
      { ...DATE, showOnCalendar: true, calendarTimeKey: 'window' },
      { key: 'window', label: 'Window', kind: 'time_range' },
    ]);
    expect(fields?.[0].calendar_time_key).toBe('window');
  });

  it('leaves an untimed calendar field all day', () => {
    const fields = fieldsOf([{ ...DATE, showOnCalendar: true }]);
    expect(fields?.[0]).toMatchObject({ show_on_calendar: true, calendar_time_key: null });
  });

  it('refuses a companion that is not a time field', () => {
    expect(
      error(
        parseBoardPatch({
          fields: [
            { ...DATE, showOnCalendar: true, calendarTimeKey: 'occasion' },
            { key: 'occasion', label: 'Occasion', kind: 'text' },
          ],
        })
      )
    ).toMatch(/must be timed by a time field/);
  });

  it('refuses a field that times itself', () => {
    expect(
      error(
        parseBoardPatch({
          fields: [{ ...DATE, showOnCalendar: true, calendarTimeKey: 'requested_date' }],
        })
      )
    ).toMatch(/cannot be timed by itself/);
  });

  it('refuses a companion the board does not have', () => {
    expect(
      error(
        parseBoardPatch({
          fields: [{ ...DATE, showOnCalendar: true, calendarTimeKey: 'nowhere' }],
        })
      )
    ).toMatch(/does not have/);
  });

  it('refuses a companion that is on its way out', () => {
    expect(
      error(
        parseBoardPatch({
          fields: [
            { ...DATE, showOnCalendar: true, calendarTimeKey: 'requested_time' },
            { ...TIME, archived: true },
          ],
        })
      )
    ).toMatch(/is archived/);
  });

  it('drops the pointer from a date field being archived', () => {
    const fields = fieldsOf([
      { ...DATE, showOnCalendar: true, calendarTimeKey: 'requested_time', archived: true },
      TIME,
    ]);
    expect(fields?.[0].calendar_time_key).toBeNull();
  });

  // Meaningless is dropped; wrong is refused. A flag on a text field is a
  // stale client, not a mistake somebody can fix.
  it('drops an on-calendar flag from a kind that is not a date', () => {
    const fields = fieldsOf([
      { key: 'occasion', label: 'Occasion', kind: 'text', showOnCalendar: true },
    ]);
    expect(fields?.[0]).toMatchObject({ show_on_calendar: false, calendar_time_key: null });
  });

  it('drops a companion named without the flag', () => {
    const fields = fieldsOf([{ ...DATE, calendarTimeKey: 'requested_time' }, TIME]);
    expect(fields?.[0].calendar_time_key).toBeNull();
  });
});

describe('due dates on the calendar', () => {
  it('reads the board toggle both ways', () => {
    expect(value(parseBoardPatch({ dueOnCalendar: false })).due_on_calendar).toBe(false);
    expect(value(parseBoardPatch({ dueOnCalendar: true })).due_on_calendar).toBe(true);
  });

  it('insists it is a boolean', () => {
    expect(error(parseBoardPatch({ dueOnCalendar: 'yes' }))).toMatch(/true or false/);
  });
});

describe('files answers', () => {
  const files = { kind: 'files', options: [] } as Pick<BoardFieldRow, 'kind' | 'options'>;
  const other = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  it('stores the ids a files answer lists, once each, and clears anything else', () => {
    const fields = [{ key: 'contract', ...files }];
    expect(normalizeProperties(fields, { contract: [UUID, 'junk', UUID, other] })).toEqual({
      contract: [UUID, other],
    });
    expect(normalizeProperties(fields, { contract: 'a string' }, { contract: [UUID] })).toEqual({});
    expect(normalizeProperties(fields, { contract: [] }, { contract: [UUID] })).toEqual({});
  });

  it('shows a files answer as a count on the card', () => {
    expect(formatProperty(files, [UUID, other])).toBe('2 files');
    expect(formatProperty(files, [UUID])).toBe('1 file');
    expect(formatProperty(files, [])).toBe('');
    expect(formatProperty(files, 'nope')).toBe('');
  });
});
