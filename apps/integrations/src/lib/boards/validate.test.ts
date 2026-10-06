import { describe, expect, it } from 'vitest';
import type { BoardFieldRow } from '@/lib/db';
import {
  emailOf,
  formatPhone,
  formatProperty,
  normalizeAnswer,
  normalizeProperties,
  parseBoardCreate,
  parseBoardPatch,
  parseCardCreate,
  parseCardPatch,
  parseViewInput,
  phoneOf,
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
  it('defaults card labels on and preserves an explicit label preference independently of visibility', () => {
    for (const showOnCard of [true, false]) {
      for (const showLabelOnCard of [undefined, true, false]) {
        const fields = value(
          parseBoardPatch({
            fields: [
              {
                key: 'party_size',
                label: 'Party size',
                kind: 'number',
                showOnCard,
                showLabelOnCard,
              },
            ],
          })
        ).fields;
        expect(fields?.[0]).toMatchObject({
          show_on_card: showOnCard,
          show_label_on_card: showLabelOnCard !== false,
        });
      }
    }
  });

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

describe('assignees and repeats', () => {
  it('takes a list of assignees, lowercased and de-duplicated in order', () => {
    expect(
      value(
        parseCardCreate({
          title: 'Deep-clean the stoves',
          assigneeEmails: [' Maya@PyreSauna.com ', 'jo@pyresauna.com', 'maya@pyresauna.com'],
        })
      ).assignee_emails
    ).toEqual(['maya@pyresauna.com', 'jo@pyresauna.com']);
  });

  it('still reads the single ownerEmail older callers send', () => {
    expect(value(parseCardPatch({ ownerEmail: 'Jo@pyresauna.com' }))).toEqual({
      assignee_emails: ['jo@pyresauna.com'],
    });
    expect(value(parseCardPatch({ ownerEmail: null }))).toEqual({ assignee_emails: [] });
  });

  it('refuses a malformed list', () => {
    expect(error(parseCardPatch({ assigneeEmails: 'jo@pyresauna.com' }))).toMatch(/assignee/);
    expect(error(parseCardPatch({ assigneeEmails: [''] }))).toMatch(/assignee/);
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@pyresauna.com`);
    expect(error(parseCardPatch({ assigneeEmails: many }))).toMatch(/assignee/);
  });

  it('takes a repeat rule, and null to stop repeating', () => {
    expect(value(parseCardPatch({ repeat: { every: 2, unit: 'week' } }))).toEqual({
      repeat_every: 2,
      repeat_unit: 'week',
    });
    expect(value(parseCardPatch({ repeat: null }))).toEqual({
      repeat_every: null,
      repeat_unit: null,
    });
    expect(error(parseCardPatch({ repeat: { every: 0, unit: 'week' } }))).toMatch(/repeat/);
    expect(error(parseCardPatch({ repeat: { every: 1, unit: 'fortnight' } }))).toMatch(/repeat/);
    expect(error(parseCardPatch({ repeat: { every: 1.5, unit: 'day' } }))).toMatch(/repeat/);
  });

  it("takes a board's default assignees", () => {
    expect(value(parseBoardPatch({ defaultAssigneeEmails: ['Jo@pyresauna.com'] }))).toEqual({
      default_assignee_emails: ['jo@pyresauna.com'],
    });
    expect(value(parseBoardPatch({ defaultAssigneeEmails: [] }))).toEqual({
      default_assignee_emails: [],
    });
    expect(error(parseBoardPatch({ defaultAssigneeEmails: 'jo' }))).toMatch(/defaultAssignee/);
  });

  it("takes each column's assignees, and leaves them alone when a column names none", () => {
    const patch = value(
      parseBoardPatch({
        columns: [
          { key: 'new', label: 'New', kind: 'open', assigneeEmails: ['Jo@pyresauna.com'] },
          { key: 'booked', label: 'Booked', kind: 'done' },
        ],
      })
    );
    expect(patch.columns?.[0].assignee_emails).toEqual(['jo@pyresauna.com']);
    expect(patch.columns?.[1]).not.toHaveProperty('assignee_emails');
    expect(
      error(
        parseBoardPatch({
          columns: [{ key: 'new', label: 'New', kind: 'open', assigneeEmails: 'jo' }],
        })
      )
    ).toMatch(/Column "new"/);
  });
});

describe('parseCardCreate', () => {
  it('takes a bare title', () => {
    expect(value(parseCardCreate({ title: '  Call the caterer  ' }))).toMatchObject({
      title: 'Call the caterer',
      column_id: null,
      assignee_emails: [],
      due_date: null,
      repeat_every: null,
      repeat_unit: null,
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
      assignee_emails: ['maya@pyresauna.com'],
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
    expect(formatProperty({ kind: 'date' }, '2026-10-03')).toBe('10.03.26');
    // A value that is not a stored date is left as it is rather than blanked.
    expect(formatProperty({ kind: 'date' }, 'next Tuesday')).toBe('next Tuesday');
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

describe('multiple requested dates', () => {
  const fields = [field({ key: 'requested_date', kind: 'date' })];
  it('normalizes date options and preserves other properties', () => {
    expect(
      normalizeProperties(
        fields,
        {
          requested_date: [' 2026-10-03 ', '2026-10-10', '2026-10-03', '2026-02-31', 42],
        },
        { contact: 'Sam' }
      )
    ).toEqual({
      contact: 'Sam',
      requested_date: ['2026-10-03', '2026-10-10'],
    });
  });
  it('clears an empty list and still accepts a single date', () => {
    expect(
      normalizeProperties(
        fields,
        { requested_date: [] },
        {
          requested_date: ['2026-10-03'],
        }
      )
    ).toEqual({});
    expect(normalizeProperties(fields, { requested_date: '2026-10-03' })).toEqual({
      requested_date: '2026-10-03',
    });
  });
  it('displays every option on cards', () => {
    expect(formatProperty(fields[0], ['2026-10-03', '2026-10-10'])).toBe('10.03.26, 10.10.26');
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

describe('email and phone answers', () => {
  const email: Pick<BoardFieldRow, 'kind' | 'options'> = { kind: 'email', options: [] };
  const phone: Pick<BoardFieldRow, 'kind' | 'options'> = { kind: 'phone', options: [] };

  it('keeps an address, lowercased, and refuses what is not one', () => {
    expect(emailOf('  Dana@PyreSauna.com ')).toBe('dana@pyresauna.com');
    expect(emailOf('dana+rentals@pyre.co.uk')).toBe('dana+rentals@pyre.co.uk');
    for (const bad of ['dana', 'dana@', '@pyresauna.com', 'dana@pyresauna', 'a b@c.com', 12]) {
      expect(emailOf(bad)).toBeNull();
    }
  });

  it('reads a phone number however it was typed', () => {
    expect(phoneOf('(212) 555-1234')).toBe('+12125551234');
    expect(phoneOf('212.555.1234')).toBe('+12125551234');
    expect(phoneOf('1 212 555 1234')).toBe('+12125551234');
    expect(phoneOf('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('refuses a number that is too short, too long, or not a number', () => {
    for (const bad of ['555-1234', '212555123456', '+1234', 'call me', '', 2125551234]) {
      expect(phoneOf(bad)).toBeNull();
    }
  });

  it('writes every way of typing one number the same way', () => {
    const typed = [
      '2125551234',
      '212-555-1234',
      '212.555.1234',
      '(212) 555 1234',
      ' +1 (212) 555-1234 ',
      '1-212-555-1234',
    ];
    const written = new Set(typed.map((raw) => formatPhone(phoneOf(raw) ?? '')));
    expect([...written]).toEqual(['(212) 555-1234']);
    // And what is stored is the one number, whichever way it arrived.
    expect(new Set(typed.map((raw) => phoneOf(raw))).size).toBe(1);
  });

  it('shows a North American number the way it is read aloud', () => {
    expect(formatPhone('+12125551234')).toBe('(212) 555-1234');
    // Anything else is shown as it is stored rather than guessed at.
    expect(formatPhone('+442079460958')).toBe('+442079460958');
    expect(formatProperty(phone, '+12125551234')).toBe('(212) 555-1234');
    expect(formatProperty(email, 'dana@pyresauna.com')).toBe('dana@pyresauna.com');
  });

  it('shapes an answer by its field, the way every other kind does', () => {
    expect(normalizeAnswer(email, ' DANA@pyresauna.com ')).toBe('dana@pyresauna.com');
    expect(normalizeAnswer(email, 'nope')).toBeNull();
    expect(normalizeAnswer(phone, '212-555-1234')).toBe('+12125551234');
    expect(normalizeAnswer(phone, 'nope')).toBeNull();
  });
});

describe('long text answers', () => {
  const long: Pick<BoardFieldRow, 'kind' | 'options'> = { kind: 'long_text', options: [] };

  it('keeps the paragraphs, and trims only the edges', () => {
    expect(normalizeAnswer(long, '  First thought.\n\nSecond thought.  ')).toBe(
      'First thought.\n\nSecond thought.'
    );
    expect(normalizeAnswer(long, '   ')).toBeNull();
    expect(normalizeAnswer(long, 42)).toBeNull();
  });

  it('holds far more than a line, and still has a limit', () => {
    const answer = normalizeAnswer(long, 'a'.repeat(9000));
    expect(typeof answer === 'string' && answer.length).toBe(4000);
    // The same text in a short text field is still held to a line.
    const short = normalizeAnswer({ kind: 'text', options: [] }, 'a'.repeat(9000));
    expect(typeof short === 'string' && short.length).toBe(500);
  });

  it('reads as one line on a card, with the breaks closed up', () => {
    expect(formatProperty(long, 'First thought.\n\nSecond thought.')).toBe(
      'First thought. Second thought.'
    );
  });
});

describe('linked cards fields', () => {
  const BOARD = '6a1b8a2c-7d4e-4a1b-9c2d-5e6f7a8b9c0d';

  it('takes a board, the columns it offers, one or many, and the far half to create', () => {
    const [field] =
      value(
        parseBoardPatch({
          fields: [
            {
              key: 'practitioner',
              label: 'Practitioner',
              kind: 'card_link',
              linkBoardId: BOARD.toUpperCase(),
              linkColumns: ['onboarded', 'active', 'active', 'Not A Key', 'inactive'],
              linkMultiple: false,
              linkInverse: { label: '  Events ', multiple: true },
            },
          ],
        })
      ).fields ?? [];
    expect(field).toMatchObject({
      kind: 'card_link',
      link_board_id: BOARD,
      link_columns: ['onboarded', 'active', 'inactive'],
      link_multiple: false,
      link_inverse: { label: 'Events', multiple: true },
      options: [],
    });
  });

  it('needs a real board id and a name for the far field', () => {
    const base = { key: 'practitioner', label: 'Practitioner', kind: 'card_link' };
    expect(error(parseBoardPatch({ fields: [{ ...base, linkBoardId: 'rentals' }] }))).toMatch(
      /needs a board/
    );
    expect(
      error(
        parseBoardPatch({
          fields: [{ ...base, linkBoardId: BOARD, linkInverse: { label: '  ' } }],
        })
      )
    ).toMatch(/name for the field on the other board/);
  });

  it('leaves the link settings empty on every other kind', () => {
    const [field] =
      value(
        parseBoardPatch({
          fields: [
            {
              key: 'note',
              label: 'Note',
              kind: 'text',
              linkBoardId: BOARD,
              linkColumns: ['active'],
              linkMultiple: true,
            },
          ],
        })
      ).fields ?? [];
    expect(field).toMatchObject({ link_board_id: null, link_columns: [], link_multiple: false });
    expect(field).not.toHaveProperty('link_inverse');
  });

  it('shapes an answer as linked card ids and reads it back as a count', () => {
    const field = { kind: 'card_link' as const, options: [] };
    expect(normalizeAnswer(field, [UUID, UUID.toUpperCase(), 'nope'])).toEqual([UUID]);
    expect(normalizeAnswer(field, 'nope')).toBeNull();
    expect(formatProperty(field, [UUID])).toBe('1 card');
    expect(formatProperty(field, [])).toBe('');
  });
});

describe('checklist fields', () => {
  const base = { key: 'onboarding', label: 'Onboarding', kind: 'checklist' };

  it('keeps the default list and the column a finished card moves to', () => {
    const [field] =
      value(
        parseBoardPatch({
          fields: [
            { ...base, checklistMd: '- [ ] One\n- [!] Two\n\n', checklistDoneColumn: 'active' },
          ],
        })
      ).fields ?? [];
    expect(field.checklist_md).toBe('- [ ] One\n- [!] Two');
    expect(field.checklist_done_column).toBe('active');
  });

  it('reads no column as staying put, and empties the config on any other kind', () => {
    const [stay, text] =
      value(
        parseBoardPatch({
          fields: [
            { ...base, checklistMd: '- [ ] One', checklistDoneColumn: '' },
            {
              key: 'note',
              label: 'Note',
              kind: 'text',
              checklistMd: '- [ ] x',
              checklistDoneColumn: 'done',
            },
          ],
        })
      ).fields ?? [];
    expect(stay.checklist_done_column).toBeNull();
    expect(text.checklist_md).toBe('');
    expect(text.checklist_done_column).toBeNull();
  });

  it('refuses a column key that cannot be one', () => {
    expect(
      error(parseBoardPatch({ fields: [{ ...base, checklistDoneColumn: 'Not A Key' }] }))
    ).toMatch(/column this board does not have/);
  });

  it('stores a card answer through normalizeProperties and shows progress', () => {
    const fields = [{ key: 'onboarding', kind: 'checklist' as const, options: [] }];
    const properties = normalizeProperties(fields, {
      onboarding: { md: '- [ ] One\n- [ ] Two', checks: [{ i: 0, t: 'One', s: false }] },
    });
    expect(formatProperty({ kind: 'checklist' }, properties.onboarding)).toBe('1 of 2');
    expect(normalizeProperties(fields, { onboarding: 'done' })).toEqual({});
  });
});

describe('parseViewInput', () => {
  it('takes a new view whole, and wants a name and a grouping', () => {
    expect(
      value(
        parseViewInput(
          {
            name: ' By month ',
            groupBy: 'field',
            groupFieldKey: 'event_date',
            dateUnit: 'month',
            layout: 'lanes',
            sortBy: 'field:event_date',
            hideFinished: false,
          },
          { create: true }
        )
      )
    ).toEqual({
      name: 'By month',
      group_by: 'field',
      group_field_key: 'event_date',
      date_unit: 'month',
      layout: 'lanes',
      sort_by: 'field:event_date',
      hide_finished: false,
    });
    expect(error(parseViewInput({ groupBy: 'column' }, { create: true }))).toMatch(/name/);
    expect(error(parseViewInput({ name: 'X' }, { create: true }))).toMatch(/groupBy/);
    expect(error(parseViewInput({ name: 'X', groupBy: 'field' }, { create: true }))).toMatch(
      /field/
    );
  });

  it('takes a patch piecemeal, and a built-in grouping clears the field', () => {
    expect(
      value(parseViewInput({ showEmpty: true, showStatus: false }, { create: false }))
    ).toEqual({ show_empty: true, show_status: false });
    expect(value(parseViewInput({ groupBy: 'assignee' }, { create: false }))).toEqual({
      group_by: 'assignee',
      group_field_key: null,
    });
  });

  it('refuses settings no view has', () => {
    expect(error(parseViewInput({ dateUnit: 'decade' }, { create: false }))).toMatch(/dateUnit/);
    expect(error(parseViewInput({ layout: 'grid' }, { create: false }))).toMatch(/layout/);
    expect(error(parseViewInput({ sortBy: 'field:' }, { create: false }))).toMatch(/sortBy/);
    expect(error(parseViewInput({ hideFinished: 'yes' }, { create: false }))).toMatch(
      /hideFinished/
    );
  });
});

describe('date & time answers', () => {
  const when: Pick<BoardFieldRow, 'kind' | 'options'> = { kind: 'datetime', options: [] };
  const fieldsOf = (fields: unknown[]) => value(parseBoardPatch({ fields })).fields;

  it('stores a day and a time, tidying the seconds and the separator', () => {
    expect(normalizeAnswer(when, '2026-10-03T18:30')).toBe('2026-10-03T18:30');
    expect(normalizeAnswer(when, ' 2026-10-03 18:30:00 ')).toBe('2026-10-03T18:30');
    // The time is optional: a day alone is an answer.
    expect(normalizeAnswer(when, '2026-10-03')).toBe('2026-10-03');
    expect(normalizeAnswer(when, ' 2026-10-03 ')).toBe('2026-10-03');
    expect(normalizeAnswer(when, '2026-02-30T18:30')).toBeNull();
    expect(normalizeAnswer(when, '2026-10-03T24:00')).toBeNull();
  });

  it('takes several, deduplicated, and drops what is not one', () => {
    expect(
      normalizeAnswer(when, ['2026-10-03T18:30', 'soon', '2026-10-03T18:30', '2026-10-04T09:00'])
    ).toEqual(['2026-10-03T18:30', '2026-10-04T09:00']);
    expect(normalizeAnswer(when, ['soon'])).toBeNull();
  });

  it('reads back as the house date and a clock time', () => {
    expect(formatProperty(when, '2026-10-03T18:30')).toBe('10.03.26 6:30 PM');
    expect(formatProperty(when, ['2026-10-03T09:05', '2026-10-04T00:00'])).toBe(
      '10.03.26 9:05 AM, 10.04.26 12:00 AM'
    );
    expect(formatProperty(when, '2026-10-03')).toBe('10.03.26');
    expect(formatProperty(when, ['2026-10-03', '2026-10-04T18:30'])).toBe(
      '10.03.26, 10.04.26 6:30 PM'
    );
    expect(formatProperty(when, 'whenever')).toBe('whenever');
  });

  it('goes on the calendar without borrowing a time field', () => {
    const fields = fieldsOf([
      {
        key: 'session',
        label: 'Session',
        kind: 'datetime',
        showOnCalendar: true,
        calendarTimeKey: 'requested_time',
      },
      { key: 'requested_time', label: 'Requested time', kind: 'time' },
    ]);
    expect(fields?.[0]).toMatchObject({ show_on_calendar: true, calendar_time_key: null });
  });
});

describe('several times', () => {
  const time: Pick<BoardFieldRow, 'kind' | 'options'> = { kind: 'time', options: [] };

  it('takes one time or several, deduplicated', () => {
    expect(normalizeAnswer(time, '18:30')).toBe('18:30');
    expect(normalizeAnswer(time, ['18:30', 'noon', '20:00', '18:30'])).toEqual(['18:30', '20:00']);
    expect(normalizeAnswer(time, ['noon'])).toBeNull();
  });

  it('reads back as a list of clock times', () => {
    expect(formatProperty(time, ['18:30', '20:00'])).toBe('6:30 PM, 8:00 PM');
    expect(formatProperty(time, '09:05')).toBe('9:05 AM');
  });
});
