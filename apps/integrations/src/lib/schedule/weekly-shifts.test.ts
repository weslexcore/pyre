import { addDays, weekStartOf } from '@pyre/schedule-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendTemplate = vi.fn();
const getDb = vi.fn();

vi.mock('@/lib/email/send', () => ({ sendTemplate: (args: unknown) => sendTemplate(args) }));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@/lib/schedule/duties', async () => {
  const { DEFAULT_DUTY_CATALOG } = await import('@pyre/schedule-core');
  return { loadDutyCatalog: async () => DEFAULT_DUTY_CATALOG };
});
// The built-in horizon: this week plus next are set, the Monday after is tentative.
vi.mock('@/lib/schedule/settings', () => ({ getConfirmedHorizonDays: async () => 14 }));

const { formatWeekLabel, runWeeklyShiftEmails, timeOffWindow } = await import('./weekly-shifts');

describe('formatWeekLabel', () => {
  it('collapses the month when the week stays inside one', () => {
    expect(formatWeekLabel('2026-08-17', '2026-08-23')).toBe('Aug 17–23');
  });

  it('repeats the month when the week straddles two', () => {
    expect(formatWeekLabel('2026-08-31', '2026-09-06')).toBe('Aug 31–Sep 6');
  });

  it('handles a week that crosses the year boundary', () => {
    expect(formatWeekLabel('2026-12-28', '2027-01-03')).toBe('Dec 28–Jan 3');
  });
});

describe('the week the roundup covers', () => {
  // Sent Monday morning for the week that starts that same day.
  it('runs Monday through Sunday from the send date', () => {
    const start = weekStartOf('2026-08-17');
    expect(start).toBe('2026-08-17');
    expect(new Date(`${start}T00:00:00`).getDay()).toBe(1);
    expect(addDays(start, 6)).toBe('2026-08-23');
  });
});

// --- The job itself, against a fake Supabase --------------------------------

/** 8am EDT on Monday 2026-08-17 — inside the send window. */
const MONDAY_8AM_ET = new Date('2026-08-17T12:00:00Z');

const ctx = { dryRun: false, timeRemainingMs: () => 50_000 };

const shift = (over: Record<string, unknown> = {}) => ({
  id: 'shift-1',
  shift_date: '2026-08-17',
  label: 'Evening',
  starts_at: '14:30',
  ends_at: '20:30',
  status: 'active',
  is_draft: false,
  notes: null,
  ...over,
});

const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'a-1',
  shift_id: 'shift-1',
  staff_id: 'staff-1',
  starts_at: '14:30',
  ends_at: '20:30',
  duties: [],
  is_draft: false,
  ...over,
});

const person = (over: Record<string, unknown> = {}) => ({
  id: 'staff-1',
  display_name: 'Omar',
  email: 'omar@example.com',
  active: true,
  ...over,
});

const timeOff = (over: Record<string, unknown> = {}) => ({
  id: 't-1',
  staff_id: 'staff-1',
  kind: 'range',
  start_date: '2026-08-28',
  end_date: '2026-08-30',
  days_of_week: [],
  starts_at: null,
  ends_at: null,
  note: null,
  is_emergency: false,
  created_by: 'staff',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

/**
 * A minimal stand-in for the Supabase query builder: every filter method is a
 * no-op that returns itself, and awaiting the chain yields the canned rows for
 * the table. The job's own filtering is what's under test, so the fake
 * deliberately does NOT apply .eq()/.in() — tables are pre-filtered per case.
 */
function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = { data: tables[table] ?? [], error: null };
      const builder: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: awaiting the chain is the Supabase builder's contract, so the fake has to be thenable too
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const method of ['select', 'gte', 'lte', 'eq', 'in']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  };
}

describe('runWeeklyShiftEmails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_8AM_ET);
    sendTemplate.mockReset().mockResolvedValue({ status: 'sent' });
    getDb.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips every day that is not Monday', async () => {
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z')); // Tuesday
    const summary = await runWeeklyShiftEmails(ctx);
    expect(summary.skipped).toBe('not-monday');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('waits for the send hour on Monday', async () => {
    vi.setSystemTime(new Date('2026-08-17T09:00:00Z')); // 5am ET
    const summary = await runWeeklyShiftEmails(ctx);
    expect(summary.skipped).toBe('before-send-hour');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('emails one roundup per person, with a deep link per shift', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [
          shift(),
          shift({ id: 'shift-2', shift_date: '2026-08-20', label: 'Morning', starts_at: '08:00' }),
        ],
        shift_assignments: [
          assignment(),
          assignment({
            id: 'a-2',
            shift_id: 'shift-2',
            starts_at: '08:00',
            ends_at: '10:00',
          }),
        ],
        staff: [person()],
        sub_requests: [],
      })
    );

    const summary = await runWeeklyShiftEmails(ctx);

    expect(summary).toMatchObject({ weekStart: '2026-08-17', sent: 1, failed: [] });
    expect(sendTemplate).toHaveBeenCalledTimes(1);

    const call = sendTemplate.mock.calls[0][0];
    expect(call.to).toBe('omar@example.com');
    expect(call.template).toBe('weekly-shifts');
    // Per-recipient key: a week-only key would let one person claim the week.
    expect(call.sendKey).toBe('weekly-shifts:2026-08-17:omar@example.com');
    expect(call.props.weekLabel).toBe('Aug 17–23');
    // 6h evening + 2h setup
    expect(call.props.totalHours).toBe('8');
    expect(call.props.shifts).toEqual([
      {
        dayLabel: 'Mon, Aug 17',
        shiftLabel: 'Evening',
        timeLabel: '2:30p–8:30p',
        shiftUrl:
          'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-17&shift=shift-1',
      },
      {
        dayLabel: 'Thu, Aug 20',
        shiftLabel: 'Morning',
        timeLabel: '8a–10a',
        shiftUrl:
          'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-20&shift=shift-2',
      },
    ]);
  });

  it('spells out the duties someone holds, and omits the line when they hold none', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift(), shift({ id: 'shift-2', shift_date: '2026-08-20', label: 'Morning' })],
        shift_assignments: [
          assignment({ duties: ['breakdown_a', 'host'] }),
          assignment({ id: 'a-2', shift_id: 'shift-2' }),
        ],
        staff: [person()],
        sub_requests: [],
      })
    );

    await runWeeklyShiftEmails(ctx);

    const [withDuties, without] = sendTemplate.mock.calls[0][0].props.shifts;
    // Phase order, not the order they were stored in.
    expect(withDuties.dutiesLabel).toBe('Host · Break Down (A)');
    expect(without).not.toHaveProperty('dutiesLabel');
  });

  it('does not email anyone without locked-in hours', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person(), person({ id: 'staff-2', display_name: 'Sunny', email: 's@example.com' })],
        sub_requests: [],
      })
    );

    const summary = await runWeeklyShiftEmails(ctx);

    expect(summary.sent).toBe(1);
    expect(summary.withoutShifts).toBe(1);
    expect(sendTemplate.mock.calls.map((c) => c[0].to)).toEqual(['omar@example.com']);
  });

  it('flags a shift the person has an open sub request on', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [{ shift_id: 'shift-1', requester_staff_id: 'staff-1', status: 'open' }],
      })
    );

    await runWeeklyShiftEmails(ctx);

    expect(sendTemplate.mock.calls[0][0].props.shifts[0].subRequested).toBe(true);
  });

  it('carries the shift notes through to the row', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift({ notes: 'Private event — 20 guests' })],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [],
      })
    );

    await runWeeklyShiftEmails(ctx);

    expect(sendTemplate.mock.calls[0][0].props.shifts[0].notes).toBe('Private event — 20 guests');
  });

  it('reports what it would send on a dry run without sending', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [],
      })
    );

    const summary = await runWeeklyShiftEmails({ ...ctx, dryRun: true });

    expect(summary.wouldSend).toEqual(['omar@example.com (1 shifts, 6h)']);
    expect(summary.sent).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('counts an already-claimed send key as a duplicate rather than a send', async () => {
    sendTemplate.mockResolvedValue({ status: 'skipped', reason: 'already-sent' });
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [],
      })
    );

    const summary = await runWeeklyShiftEmails(ctx);

    expect(summary).toMatchObject({ sent: 0, duplicates: 1 });
  });

  it('stops cleanly when the tick runs out of budget', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [],
      })
    );

    const summary = await runWeeklyShiftEmails({ dryRun: false, timeRemainingMs: () => 100 });

    expect(summary.outOfTime).toBe(true);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('splits time off at the horizon: set weeks, then the two weeks scheduled next', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [],
        time_off: [
          // Inside the set window (Aug 17–30).
          timeOff({ note: 'Wedding' }),
          // Straddles the boundary — listed in both windows.
          timeOff({ id: 't-2', start_date: '2026-08-30', end_date: '2026-09-01' }),
          // Only in the upcoming window (Aug 31–Sep 13), with hours.
          timeOff({
            id: 't-3',
            start_date: '2026-09-04',
            end_date: '2026-09-04',
            starts_at: '09:00',
            ends_at: '12:00',
          }),
          // Past the upcoming window — not mentioned.
          timeOff({ id: 't-4', start_date: '2026-09-20', end_date: '2026-09-21' }),
          // Someone else's.
          timeOff({
            id: 't-5',
            staff_id: 'staff-2',
            start_date: '2026-08-18',
            end_date: '2026-08-18',
          }),
        ],
      })
    );

    await runWeeklyShiftEmails(ctx);

    const { props } = sendTemplate.mock.calls[0][0];
    expect(props.availabilityUrl).toBe(
      'https://pyre-integrations.vercel.app/admin/schedule/availability'
    );
    expect(props.timeOff.confirmed).toEqual({
      rangeLabel: 'Aug 17–30',
      items: [
        { whenLabel: 'Fri, Aug 28 – Sun, Aug 30', timeLabel: 'All day', note: 'Wedding' },
        { whenLabel: 'Sun, Aug 30 – Tue, Sep 1', timeLabel: 'All day' },
      ],
    });
    expect(props.timeOff.upcoming).toEqual({
      rangeLabel: 'Aug 31–Sep 13',
      items: [
        { whenLabel: 'Sun, Aug 30 – Tue, Sep 1', timeLabel: 'All day' },
        { whenLabel: 'Fri, Sep 4', timeLabel: '9a–12p' },
      ],
    });
  });

  it('sends empty time-off windows when nothing is logged, so the ask still goes out', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person()],
        sub_requests: [],
      })
    );

    await runWeeklyShiftEmails(ctx);

    expect(sendTemplate.mock.calls[0][0].props.timeOff).toEqual({
      confirmed: { rangeLabel: 'Aug 17–30', items: [] },
      upcoming: { rangeLabel: 'Aug 31–Sep 13', items: [] },
    });
  });

  it('lists off-shift duties, and emails someone who has only those', async () => {
    getDb.mockReturnValue(
      fakeDb({
        shifts: [shift()],
        shift_assignments: [assignment()],
        staff: [person(), person({ id: 'staff-2', display_name: 'Sunny', email: 's@example.com' })],
        sub_requests: [],
        duty_assignments: [
          { id: 'd-1', duty_key: 'host', duty_date: '2026-08-18', staff_id: 'staff-2' },
        ],
      })
    );

    const summary = await runWeeklyShiftEmails(ctx);

    expect(summary.sent).toBe(2);
    const sunny = sendTemplate.mock.calls.find((c) => c[0].to === 's@example.com')?.[0];
    expect(sunny.props.shifts).toEqual([]);
    expect(sunny.props.offShiftDuties).toEqual([
      {
        dayLabel: 'Tue, Aug 18',
        dutyLabel: 'Host',
        dayUrl: 'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-18',
      },
    ]);
    const omar = sendTemplate.mock.calls.find((c) => c[0].to === 'omar@example.com')?.[0];
    expect(omar.props).not.toHaveProperty('offShiftDuties');
  });
});

describe('timeOffWindow', () => {
  const rule = (over: Record<string, unknown> = {}) =>
    timeOff({
      id: 'r-1',
      kind: 'recurring',
      start_date: null,
      end_date: null,
      days_of_week: [4, 2],
      starts_at: '09:00',
      ends_at: '12:00',
      ...over,
    }) as never;

  it('shows a weekly rule in every window it reaches, days in week order', () => {
    const window = timeOffWindow([rule()], '2026-08-17', '2026-08-30');
    expect(window.items).toEqual([{ whenLabel: 'Every Tue/Thu', timeLabel: '9a–12p' }]);
  });

  it('names the end of a rule that stops, and drops one that has already stopped', () => {
    expect(
      timeOffWindow([rule({ end_date: '2026-08-20' })], '2026-08-17', '2026-08-30').items
    ).toEqual([{ whenLabel: 'Every Tue/Thu (through Thu, Aug 20)', timeLabel: '9a–12p' }]);
    expect(
      timeOffWindow([rule({ end_date: '2026-08-16' })], '2026-08-17', '2026-08-30').items
    ).toEqual([]);
  });

  it('orders entries by the first day they apply inside the window', () => {
    const window = timeOffWindow(
      [
        timeOff({ id: 'later', start_date: '2026-08-21', end_date: '2026-08-21' }) as never,
        // Wednesday rule first applies Aug 19, before the Friday trip.
        rule({ days_of_week: [3] }),
      ],
      '2026-08-17',
      '2026-08-30'
    );
    expect(window.items.map((i) => i.whenLabel)).toEqual(['Every Wed', 'Fri, Aug 21']);
  });
});
