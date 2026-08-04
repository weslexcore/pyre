// The availability engine is what stops someone getting scheduled during time
// off the sheet used to require checking by hand (especially the time-bounded
// recurring rules) — so the sheet's real blackout shapes are pinned here.

import { describe, expect, it } from 'vitest';
import type { TimeOffRow } from '@/lib/db';
import {
  availabilityFor,
  busyIntervalOn,
  dayOfWeek,
  findAssignmentConflicts,
  minutesToTime,
  timeToMinutes,
} from './availability';

const STAFF = 'staff-1';

function entry(partial: Partial<TimeOffRow>): TimeOffRow {
  return {
    id: 'to-1',
    staff_id: STAFF,
    kind: 'range',
    start_date: null,
    end_date: null,
    days_of_week: [],
    starts_at: null,
    ends_at: null,
    note: null,
    created_by: 'admin',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('time helpers', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(timeToMinutes('14:30')).toBe(870);
    expect(timeToMinutes('14:30:00')).toBe(870);
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('formats minutes back to HH:MM', () => {
    expect(minutesToTime(870)).toBe('14:30');
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('gets the weekday of a calendar date regardless of host timezone', () => {
    expect(dayOfWeek('2026-08-09')).toBe(0); // a Sunday
    expect(dayOfWeek('2026-08-10')).toBe(1); // a Monday
  });
});

describe('busyIntervalOn', () => {
  it('applies a trip range on every day within it, inclusive of both ends', () => {
    const trip = entry({ kind: 'range', start_date: '2026-08-05', end_date: '2026-08-09' });
    expect(busyIntervalOn(trip, '2026-08-04')).toBeNull();
    expect(busyIntervalOn(trip, '2026-08-05')).toMatchObject({ wholeDay: true });
    expect(busyIntervalOn(trip, '2026-08-09')).toMatchObject({ wholeDay: true });
    expect(busyIntervalOn(trip, '2026-08-10')).toBeNull();
  });

  it('applies a recurring rule only on its weekdays', () => {
    // Omar: no Sundays
    const rule = entry({ kind: 'recurring', days_of_week: [0] });
    expect(busyIntervalOn(rule, '2026-08-09')).toMatchObject({ wholeDay: true }); // Sunday
    expect(busyIntervalOn(rule, '2026-08-10')).toBeNull(); // Monday
  });

  it('bounds a recurring rule by its start/end dates', () => {
    // Sunny: Mon/Wed/Fri mornings, Aug 18 – Dec 7
    const rule = entry({
      kind: 'recurring',
      days_of_week: [1, 3, 5],
      start_date: '2026-08-18',
      end_date: '2026-12-07',
      starts_at: '00:00',
      ends_at: '12:00',
    });
    expect(busyIntervalOn(rule, '2026-08-14')).toBeNull(); // Friday before bounds
    expect(busyIntervalOn(rule, '2026-08-19')).toMatchObject({
      // Wednesday inside
      startMin: 0,
      endMin: 720,
      wholeDay: false,
    });
    expect(busyIntervalOn(rule, '2026-12-09')).toBeNull(); // Wednesday after bounds
  });
});

describe('availabilityFor', () => {
  const evening = [timeToMinutes('14:30'), timeToMinutes('20:30')] as const;

  it('is free with no entries', () => {
    expect(availabilityFor([], STAFF, '2026-08-13', ...evening).status).toBe('free');
  });

  it('ignores other staff members’ entries', () => {
    const trip = entry({ kind: 'range', start_date: '2026-08-13', end_date: '2026-08-13' });
    expect(availabilityFor([trip], 'staff-2', '2026-08-13', ...evening).status).toBe('free');
  });

  it('flags a partial overlap the sheet could only mark "check manually"', () => {
    // Sarah: Thursdays 17:30–21:00 → evening shift 14:30–20:30 is partially blocked
    const rule = entry({
      kind: 'recurring',
      days_of_week: [4],
      start_date: '2026-08-06',
      end_date: '2026-11-22',
      starts_at: '17:30',
      ends_at: '21:00',
    });
    const result = availabilityFor([rule], STAFF, '2026-08-13', ...evening); // a Thursday
    expect(result.status).toBe('partial');
    expect(result.conflicts).toHaveLength(1);
  });

  it('is busy when the window is fully covered', () => {
    const trip = entry({ kind: 'range', start_date: '2026-08-13', end_date: '2026-08-13' });
    expect(availabilityFor([trip], STAFF, '2026-08-13', ...evening).status).toBe('busy');
  });

  it('treats interval ends as exclusive — time off ending at shift start is fine', () => {
    const rule = entry({
      kind: 'recurring',
      days_of_week: [4],
      starts_at: '10:30',
      ends_at: '14:30',
    });
    expect(availabilityFor([rule], STAFF, '2026-08-13', ...evening).status).toBe('free');
  });

  it('is busy when two touching intervals jointly cover the window', () => {
    const morning = entry({
      id: 'to-a',
      kind: 'recurring',
      days_of_week: [4],
      starts_at: '00:00',
      ends_at: '17:00',
    });
    const eveningRule = entry({
      id: 'to-b',
      kind: 'recurring',
      days_of_week: [4],
      starts_at: '17:00',
      ends_at: '23:30',
    });
    const result = availabilityFor([morning, eveningRule], STAFF, '2026-08-13', ...evening);
    expect(result.status).toBe('busy');
    expect(result.conflicts).toHaveLength(2);
  });

  it('is partial when intervals overlap but leave a gap in the window', () => {
    const early = entry({
      id: 'to-a',
      kind: 'recurring',
      days_of_week: [4],
      starts_at: '00:00',
      ends_at: '16:00',
    });
    const late = entry({
      id: 'to-b',
      kind: 'recurring',
      days_of_week: [4],
      starts_at: '18:00',
      ends_at: '23:30',
    });
    expect(availabilityFor([early, late], STAFF, '2026-08-13', ...evening).status).toBe('partial');
  });
});

describe('findAssignmentConflicts', () => {
  it('flags assignments that overlap time off, and only those', () => {
    const trip = entry({ kind: 'range', start_date: '2026-08-07', end_date: '2026-08-09' });
    const make = (id: string, date: string) => ({
      shiftDate: date,
      assignment: {
        id,
        shift_id: 'shift-1',
        staff_id: STAFF,
        starts_at: '14:30:00',
        ends_at: '20:30:00',
        role: 'full' as const,
        notes: null,
        created_at: '',
        updated_at: '',
      },
    });
    const conflicts = findAssignmentConflicts(
      [make('a', '2026-08-06'), make('b', '2026-08-08')],
      [trip]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].assignment.id).toBe('b');
  });
});
