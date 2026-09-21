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
