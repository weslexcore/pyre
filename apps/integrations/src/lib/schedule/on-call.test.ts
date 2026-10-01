// The drafting side of on-call: recommendOnCall plans a draft week as if the
// draft were already live, so a founder the draft puts on a day takes that
// day's calls. The rule itself is pinned in schedule-core's on-call tests;
// this covers merging the draft into the live week.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: () => null }));

const { recommendOnCall } = await import('./on-call');

/** Canned rows per table; filters are no-ops (rows are pre-filtered per case). */
function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = { data: tables[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: awaiting the chain is the Supabase builder's contract, so the fake has to be thenable too
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const method of ['select', 'gte', 'lte', 'eq', 'in', 'order']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as never;
}

const WEEK = '2026-10-05'; // a Monday

const staff = [
  { id: 'wes', display_name: 'Wes', active: true, on_call_eligible: true },
  { id: 'julien', display_name: 'Julien', active: true, on_call_eligible: true },
  { id: 'sunny', display_name: 'Sunny', active: true, on_call_eligible: false },
];

const live = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id,
  shift_date: date,
  label: 'Morning',
  starts_at: '09:00:00',
  ends_at: '13:00:00',
  status: 'active',
  is_draft: false,
  on_call_staff_id: null,
  on_call_manual: false,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T16:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('recommendOnCall', () => {
  it('puts a founder the draft adds to a day on call for that day', async () => {
    const db = fakeDb({
      shifts: [
        live('mon-am', WEEK),
        live('mon-pm', WEEK, { starts_at: '17:00:00', ends_at: '21:00:00' }),
      ],
      shift_assignments: [{ shift_id: 'mon-pm', staff_id: 'sunny', is_draft: false }],
      staff,
      time_off: [],
    });
    const recs = await recommendOnCall(db, WEEK, {
      shifts: [],
      assignments: [{ shiftId: 'mon-am', staffId: 'julien' }],
    });
    expect(recs).toEqual([
      { shiftId: 'mon-am', staffId: 'julien', name: 'Julien', reason: 'on_shift' },
      { shiftId: 'mon-pm', staffId: 'julien', name: 'Julien', reason: 'working_day' },
    ]);
  });

  it("covers the draft's new shifts", async () => {
    const db = fakeDb({ shifts: [], shift_assignments: [], staff, time_off: [] });
    const recs = await recommendOnCall(db, WEEK, {
      shifts: [
        { id: 'key:extra', shift_date: WEEK, starts_at: '10:00', ends_at: '14:00', label: 'Event' },
      ],
      assignments: [{ shiftId: 'key:extra', staffId: 'wes' }],
    });
    expect(recs).toEqual([
      { shiftId: 'key:extra', staffId: 'wes', name: 'Wes', reason: 'on_shift' },
    ]);
  });

  it('leaves alone a shift already on call with the right person', async () => {
    const db = fakeDb({
      shifts: [live('mon-am', WEEK, { on_call_staff_id: 'wes' })],
      shift_assignments: [{ shift_id: 'mon-am', staff_id: 'wes', is_draft: false }],
      staff,
      time_off: [],
    });
    const recs = await recommendOnCall(db, WEEK, {
      shifts: [],
      assignments: [{ shiftId: 'mon-am', staffId: 'sunny' }],
    });
    expect(recs).toEqual([]);
  });

  it('recommends nothing for a week already behind us', async () => {
    const db = fakeDb({ shifts: [], shift_assignments: [], staff, time_off: [] });
    expect(
      await recommendOnCall(db, '2026-09-21', {
        shifts: [],
        assignments: [],
      })
    ).toEqual([]);
  });
});
