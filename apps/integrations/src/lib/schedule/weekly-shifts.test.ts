import { addDays, weekStartOf } from '@pyre/schedule-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendTemplate = vi.fn();
const getDb = vi.fn();

vi.mock('@/lib/email/send', () => ({ sendTemplate: (args: unknown) => sendTemplate(args) }));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));

const { formatDayLabel, formatWeekLabel, runWeeklyShiftEmails } = await import('./weekly-shifts');

describe('formatDayLabel', () => {
  it('renders the compact weekday label', () => {
    expect(formatDayLabel('2026-08-17')).toBe('Mon, Aug 17');
    expect(formatDayLabel('2026-08-20')).toBe('Thu, Aug 20');
  });
});

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
  role: 'full',
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
            role: 'setup',
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
        roleLabel: 'setup',
        shiftUrl:
          'https://pyre-integrations.vercel.app/admin/schedule?view=week&date=2026-08-20&shift=shift-2',
      },
    ]);
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
});
