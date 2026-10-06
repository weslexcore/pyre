import { describe, expect, it } from 'vitest';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow } from '@/lib/db';
import type { LinkSummary } from './links';
import { dateBucket, groupCards, type ViewSpec, viewProblem } from './views';

const col = (id: string, kind: BoardColumnRow['kind'], sort: number): BoardColumnRow =>
  ({
    id,
    board_id: 'b',
    key: id,
    label: id[0].toUpperCase() + id.slice(1),
    kind,
    assignee_emails: [],
    sort_order: sort,
    archived: false,
    created_at: '',
    updated_at: '',
  }) as BoardColumnRow;

const COLUMNS = [col('new', 'open', 10), col('booked', 'open', 20), col('done', 'done', 30)];

const field = (key: string, kind: BoardFieldRow['kind'], over: Partial<BoardFieldRow> = {}) =>
  ({
    id: `f-${key}`,
    board_id: 'b',
    key,
    label: key,
    kind,
    options: [],
    hint: null,
    show_on_card: false,
    show_label_on_card: true,
    show_on_calendar: false,
    calendar_time_key: null,
    link_board_id: null,
    link_columns: [],
    link_multiple: false,
    link_inverse_field_id: null,
    checklist_md: '',
    checklist_done_column: null,
    sort_order: 0,
    archived: false,
    created_at: '',
    updated_at: '',
    ...over,
  }) as BoardFieldRow;

let n = 0;
const card = (over: Partial<BoardCardRow> = {}) =>
  ({
    id: `c${++n}`,
    column_id: 'new',
    title: `Card ${n}`,
    assignee_emails: [],
    due_date: null,
    properties: {},
    sort_order: n,
    created_at: `2026-10-0${(n % 9) + 1}T15:00:00Z`,
    ...over,
  }) as BoardCardRow;

const view = (over: Partial<ViewSpec> = {}): ViewSpec => ({
  group_by: 'field',
  group_field_key: null,
  date_unit: null,
  sort_by: 'manual',
  hide_finished: false,
  show_empty: false,
  ...over,
});

function groups(spec: ViewSpec, cards: BoardCardRow[], fields: BoardFieldRow[] = [], extra = {}) {
  const result = groupCards(spec, { cards, columns: COLUMNS, fields, ...extra });
  if (!result.ok) throw new Error(result.reason);
  return result.groups.map((g) => ({ label: g.label, titles: g.cards.map((c) => c.title) }));
}

describe('dateBucket', () => {
  it('names each unit the way a heading reads', () => {
    expect(dateBucket('2026-10-06', 'day')).toEqual({
      key: '2026-10-06',
      label: 'Tue, Oct 6, 2026',
    });
    expect(dateBucket('2026-10-06', 'week')).toEqual({
      key: '2026-10-04',
      label: 'Week of Oct 4, 2026',
    });
    expect(dateBucket('2026-10-06', 'month')).toEqual({ key: '2026-10-01', label: 'October 2026' });
    expect(dateBucket('2026-10-06', 'year')).toEqual({ key: '2026', label: '2026' });
  });
});

describe('groupCards by a date field', () => {
  const when = field('event_date', 'date');
  const spec = view({ group_field_key: 'event_date', date_unit: 'month' });

  it('groups by month in date order with the undated last', () => {
    const cards = [
      card({ title: 'Dec', properties: { event_date: '2026-12-01' } }),
      card({ title: 'Undated' }),
      card({ title: 'Nov a', properties: { event_date: '2026-11-20' } }),
      card({ title: 'Nov b', properties: { event_date: '2026-11-02' } }),
    ];
    expect(groups(spec, cards, [when])).toEqual([
      { label: 'November 2026', titles: ['Nov a', 'Nov b'] },
      { label: 'December 2026', titles: ['Dec'] },
      { label: 'No date', titles: ['Undated'] },
    ]);
  });

  it("puts a form's several dates in each of their months, once per month", () => {
    const cards = [
      card({
        title: 'Series',
        properties: { event_date: ['2026-11-01', '2026-11-08', '2027-01-03'] },
      }),
    ];
    expect(groups(spec, cards, [when])).toEqual([
      { label: 'November 2026', titles: ['Series'] },
      { label: 'January 2027', titles: ['Series'] },
    ]);
  });

  it('sorts a group by the field when asked, the unanswered last', () => {
    const sorted = view({ ...spec, sort_by: 'field:event_date' });
    const cards = [
      card({ title: 'Late', properties: { event_date: '2026-11-20' } }),
      card({ title: 'Early', properties: { event_date: '2026-11-02' } }),
    ];
    expect(groups(sorted, cards, [when])[0].titles).toEqual(['Early', 'Late']);
  });
});

describe('groupCards by the built-ins', () => {
  it('groups by due date by year', () => {
    const spec = view({ group_by: 'due_date', date_unit: 'year' });
    const cards = [
      card({ title: 'A', due_date: '2027-02-01' }),
      card({ title: 'B', due_date: '2026-03-01' }),
    ];
    expect(groups(spec, cards).map((g) => g.label)).toEqual(['2026', '2027']);
  });

  it('groups by column in board order, and lists empty columns when asked', () => {
    const cards = [card({ title: 'Booked', column_id: 'booked' })];
    expect(groups(view({ group_by: 'column' }), cards)).toEqual([
      { label: 'Booked', titles: ['Booked'] },
    ]);
    expect(
      groups(view({ group_by: 'column', show_empty: true }), cards).map((g) => g.label)
    ).toEqual(['New', 'Booked', 'Done']);
  });

  it('groups by assignee with the viewer first, a shared card on both, Unassigned last', () => {
    const cards = [
      card({ title: 'Shared', assignee_emails: ['zoe@pyresauna.com', 'wes@pyresauna.com'] }),
      card({ title: 'Ana', assignee_emails: ['ana@pyresauna.com'] }),
      card({ title: 'Nobody' }),
    ];
    const result = groups(view({ group_by: 'assignee' }), cards, [], {
      viewerEmail: 'wes@pyresauna.com',
    });
    expect(result).toEqual([
      { label: 'wes', titles: ['Shared'] },
      { label: 'ana', titles: ['Ana'] },
      { label: 'zoe', titles: ['Shared'] },
      { label: 'Unassigned', titles: ['Nobody'] },
    ]);
  });

  it('leaves finished cards out when the view hides them', () => {
    const cards = [card({ title: 'Open' }), card({ title: 'Shipped', column_id: 'done' })];
    expect(groups(view({ group_by: 'column', hide_finished: true }), cards)).toEqual([
      { label: 'New', titles: ['Open'] },
    ]);
  });
});

describe('groupCards by choice fields', () => {
  const practice = field('practice', 'choice', { options: ['Breathwork', 'Sound', 'Yoga'] });

  it("orders option groups the field's way, None last, empty options only when asked", () => {
    const spec = view({ group_field_key: 'practice' });
    const cards = [
      card({ title: 'Y', properties: { practice: 'Yoga' } }),
      card({ title: 'B', properties: { practice: 'Breathwork' } }),
      card({ title: '?' }),
    ];
    expect(groups(spec, cards, [practice]).map((g) => g.label)).toEqual([
      'Breathwork',
      'Yoga',
      'None',
    ]);
    expect(groups({ ...spec, show_empty: true }, cards, [practice]).map((g) => g.label)).toEqual([
      'Breathwork',
      'Sound',
      'Yoga',
      'None',
    ]);
  });

  it('puts a multi-choice card under each option it picked', () => {
    const tags = field('tags', 'multi_choice', { options: ['Hot', 'Cold'] });
    const cards = [card({ title: 'Both', properties: { tags: ['Cold', 'Hot'] } })];
    expect(groups(view({ group_field_key: 'tags' }), cards, [tags])).toEqual([
      { label: 'Hot', titles: ['Both'] },
      { label: 'Cold', titles: ['Both'] },
    ]);
  });

  it('groups yes/no answers', () => {
    const paid = field('paid', 'yes_no');
    const cards = [
      card({ title: 'N', properties: { paid: false } }),
      card({ title: 'Y', properties: { paid: true } }),
      card({ title: '?' }),
    ];
    expect(groups(view({ group_field_key: 'paid' }), cards, [paid]).map((g) => g.label)).toEqual([
      'Yes',
      'No',
      'Not answered',
    ]);
  });
});

describe('groupCards by linked cards', () => {
  const practitioner = field('practitioner', 'card_link');
  const summary = (id: string, title: string): LinkSummary => ({
    id,
    title,
    board_slug: 'practitioners',
    board_name: 'Practitioners',
    column_key: 'active',
    column_label: 'Active',
    column_kind: 'open',
    openable: true,
  });
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const links = new Map([
    [P1, summary(P1, 'Ana Ruiz')],
    [P2, summary(P2, 'Ben Cole')],
  ]);

  it("groups by each linked card's title, with its board, the unlinked last", () => {
    const cards = [
      card({ title: 'Duo', properties: { practitioner: [P2, P1] } }),
      card({ title: 'Solo', properties: { practitioner: [P2] } }),
      card({ title: 'TBD' }),
    ];
    const result = groupCards(view({ group_field_key: 'practitioner' }), {
      cards,
      columns: COLUMNS,
      fields: [practitioner],
      links,
    });
    if (!result.ok) throw new Error('expected groups');
    expect(result.groups.map((g) => [g.label, g.sublabel, g.cards.map((c) => c.title)])).toEqual([
      ['Ana Ruiz', 'Practitioners · Active', ['Duo']],
      ['Ben Cole', 'Practitioners · Active', ['Duo', 'Solo']],
      ['Not linked', undefined, ['TBD']],
    ]);
  });
});

describe('groupCards by checklist, text, number, time', () => {
  it('groups a checklist by how far along it is', () => {
    const steps = field('steps', 'checklist', { checklist_md: '- [ ] Quote\n- [ ] Sign' });
    const cards = [
      card({ title: 'Fresh' }),
      card({
        title: 'Half',
        properties: {
          steps: {
            md: '- [ ] Quote\n- [ ] Sign',
            checks: [{ i: 0, t: 'Quote', s: false, by: 'x', at: '' }],
          },
        },
      }),
      card({
        title: 'All',
        properties: {
          steps: {
            md: '- [ ] Quote\n- [ ] Sign',
            checks: [
              { i: 0, t: 'Quote', s: false, by: 'x', at: '' },
              { i: 1, t: 'Sign', s: false, by: 'x', at: '' },
            ],
          },
        },
      }),
    ];
    expect(groups(view({ group_field_key: 'steps' }), cards, [steps])).toEqual([
      { label: 'Done', titles: ['All'] },
      { label: 'In progress', titles: ['Half'] },
      { label: 'Not started', titles: ['Fresh'] },
    ]);
  });

  it('treats the same words in another case as one group', () => {
    const city = field('city', 'text');
    const cards = [
      card({ title: 'A', properties: { city: 'Brooklyn' } }),
      card({ title: 'B', properties: { city: 'brooklyn ' } }),
    ];
    expect(groups(view({ group_field_key: 'city' }), cards, [city])).toEqual([
      { label: 'Brooklyn', titles: ['A', 'B'] },
    ]);
  });

  it('orders numbers as numbers', () => {
    const size = field('size', 'number');
    const cards = [
      card({ title: 'Ten', properties: { size: 10 } }),
      card({ title: 'Nine', properties: { size: 9 } }),
    ];
    expect(groups(view({ group_field_key: 'size' }), cards, [size]).map((g) => g.label)).toEqual([
      '9',
      '10',
    ]);
  });

  it('groups a time range by the hour it starts', () => {
    const slot = field('slot', 'time_range');
    const cards = [
      card({ title: 'Eve', properties: { slot: ['18:30', '20:00'] } }),
      card({ title: 'Morn', properties: { slot: ['07:00', '08:00'] } }),
    ];
    expect(groups(view({ group_field_key: 'slot' }), cards, [slot]).map((g) => g.label)).toEqual([
      '7:00 AM',
      '6:00 PM',
    ]);
  });
});

describe('a view whose field is gone', () => {
  it('says so instead of grouping', () => {
    const archived = field('old', 'choice', { archived: true });
    expect(
      groupCards(view({ group_field_key: 'old' }), {
        cards: [],
        columns: COLUMNS,
        fields: [archived],
      })
    ).toEqual({ ok: false, reason: 'missing_field' });
    expect(
      groupCards(view({ group_field_key: 'gone' }), { cards: [], columns: COLUMNS, fields: [] })
    ).toEqual({ ok: false, reason: 'missing_field' });
  });
});

describe('viewProblem', () => {
  const fields = [
    field('event_date', 'date'),
    field('practice', 'choice'),
    field('notes', 'long_text'),
  ];
  const base = { group_by: 'field' as const, date_unit: null, sort_by: 'manual' };

  it('wants a unit with a date grouping and only there', () => {
    expect(viewProblem({ ...base, group_field_key: 'event_date' }, fields)).toMatch(/month/);
    expect(
      viewProblem({ ...base, group_field_key: 'event_date', date_unit: 'month' }, fields)
    ).toBeNull();
    expect(viewProblem({ ...base, group_field_key: 'practice', date_unit: 'day' }, fields)).toMatch(
      /Only a date/
    );
    expect(
      viewProblem(
        { group_by: 'created_at', group_field_key: null, date_unit: 'week', sort_by: 'title' },
        fields
      )
    ).toBeNull();
  });

  it('refuses a field it cannot group or sort by', () => {
    expect(viewProblem({ ...base, group_field_key: 'notes' }, fields)).toMatch(/group by/);
    expect(viewProblem({ ...base, group_field_key: 'missing' }, fields)).toMatch(/group by/);
    expect(
      viewProblem({ ...base, group_field_key: 'practice', sort_by: 'field:practice' }, fields)
    ).toMatch(/sorts by/);
  });
});
