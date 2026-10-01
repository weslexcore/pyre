import { describe, expect, it } from 'vitest';
import type { ShiftAssignmentRow, ShiftRow } from '@/lib/db';
import { isInSession, isUpcoming, pickOnCallShifts, pickWeekShifts } from './next-shift';

const now = { date: '2026-08-31', minutes: 14 * 60 }; // Mon 2pm ET

describe('isUpcoming', () => {
  it('counts any future date', () => {
    expect(isUpcoming({ shift_date: '2026-09-01', ends_at: '10:00' }, now)).toBe(true);
  });

  it('drops past dates', () => {
    expect(isUpcoming({ shift_date: '2026-08-30', ends_at: '22:00' }, now)).toBe(false);
  });

  it("keeps today's shift until it ends (in progress counts)", () => {
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '14:01' }, now)).toBe(true);
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '22:00' }, now)).toBe(true);
  });

  it("drops today's shift once it has ended", () => {
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '14:00' }, now)).toBe(false);
    expect(isUpcoming({ shift_date: '2026-08-31', ends_at: '09:00' }, now)).toBe(false);
  });
});

describe('isInSession', () => {
  it('is live when today and the window contains now', () => {
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '12:00', ends_at: '16:00' }, now)
    ).toBe(true);
    // Starting exactly now counts as live.
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '14:00', ends_at: '16:00' }, now)
    ).toBe(true);
  });

  it('is not live before it starts, once it ends, or on another day', () => {
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '16:00', ends_at: '20:00' }, now)
    ).toBe(false);
    expect(
      isInSession({ shift_date: '2026-08-31', starts_at: '10:00', ends_at: '14:00' }, now)
    ).toBe(false);
    expect(
      isInSession({ shift_date: '2026-09-01', starts_at: '12:00', ends_at: '16:00' }, now)
    ).toBe(false);
  });
});

describe('pickWeekShifts', () => {
  const shift = (id: string, shift_date: string, starts_at: string, ends_at: string) =>
    ({ id, shift_date, starts_at, ends_at, label: id }) as ShiftRow;
  const assignment = (id: string, shift_id: string, starts_at: string) =>
    ({ id, shift_id, starts_at, ends_at: '22:00' }) as ShiftAssignmentRow;

  it("keeps only the viewer's shifts, in date then start order", () => {
    const shifts = [
      shift('wed', '2026-09-02', '16:00', '22:00'),
      shift('mon-eve', '2026-08-31', '16:00', '22:00'),
      shift('mon-am', '2026-08-31', '08:00', '12:00'),
      shift('tue', '2026-09-01', '16:00', '22:00'),
    ];
    const mine = [
      assignment('a1', 'wed', '16:00'),
      assignment('a2', 'mon-am', '08:00'),
      assignment('a3', 'mon-eve', '16:00'),
    ];
    const week = pickWeekShifts(shifts, mine, now);
    expect(week.map((w) => w.shift.id)).toEqual(['mon-am', 'mon-eve', 'wed']);
  });

  it('flags past, today and in-session shifts on the ET clock', () => {
    const shifts = [
      shift('am', '2026-08-31', '08:00', '12:00'),
      shift('mid', '2026-08-31', '12:00', '16:00'),
      shift('next', '2026-09-01', '08:00', '12:00'),
    ];
    const mine = [
      assignment('a1', 'am', '08:00'),
      assignment('a2', 'mid', '12:00'),
      assignment('a3', 'next', '08:00'),
    ];
    const [am, mid, next] = pickWeekShifts(shifts, mine, now);
    expect(am).toMatchObject({ isPast: true, isToday: true, isInSession: false });
    expect(mid).toMatchObject({ isPast: false, isToday: true, isInSession: true });
    expect(next).toMatchObject({ isPast: false, isToday: false, isInSession: false });
  });
});

describe('pickOnCallShifts', () => {
  const row = (id: string, date: string, startsAt: string, endsAt: string, over = {}) =>
    ({
      id,
      shift_date: date,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'active',
      is_draft: false,
      on_call_staff_id: `oncall-${id}`,
      ...over,
    }) as ShiftRow;

  it('lists every shift live right now', () => {
    const picked = pickOnCallShifts(
      [
        row('day', '2026-08-31', '10:00', '16:00'),
        row('event', '2026-08-31', '13:00', '15:00'),
        row('evening', '2026-08-31', '17:00', '21:00'),
      ],
      now
    );
    expect(picked.map((p) => [p.shift.id, p.onCallStaffId, p.isInSession])).toEqual([
      ['day', 'oncall-day', true],
      ['event', 'oncall-event', true],
    ]);
  });

  it('falls back to the next shift between shifts', () => {
    const picked = pickOnCallShifts(
      [
        row('tomorrow', '2026-09-01', '09:00', '13:00'),
        row('morning', '2026-08-31', '07:00', '12:00'),
        row('evening', '2026-08-31', '17:00', '21:00'),
      ],
      now
    );
    expect(picked.map((p) => [p.shift.id, p.isToday, p.isInSession])).toEqual([
      ['evening', true, false],
    ]);
  });

  it('skips cancelled and draft shifts, and keeps a shift with nobody on call', () => {
    const picked = pickOnCallShifts(
      [
        row('cancelled', '2026-08-31', '13:00', '15:00', { status: 'cancelled' }),
        row('draft', '2026-08-31', '13:00', '15:00', { is_draft: true }),
        row('open', '2026-08-31', '13:00', '16:00', { on_call_staff_id: null }),
      ],
      now
    );
    expect(picked.map((p) => [p.shift.id, p.onCallStaffId])).toEqual([['open', null]]);
  });
});
