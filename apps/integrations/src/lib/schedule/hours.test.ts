// Hours rollup: verified against the sheet's own "Total Hours" numbers for
// the week of Jul 8–12, 2026 (including the 0.759 "% founders" cell).

import { describe, expect, it } from 'vitest';
import type { ShiftAssignmentRow } from '@/lib/db';
import { addDays, assignmentHours, rollupHours, weekStartOf } from './hours';

function assignment(
  staffId: string,
  shiftDate: string,
  startsAt: string,
  endsAt: string
): { assignment: ShiftAssignmentRow; shiftDate: string } {
  return {
    shiftDate,
    assignment: {
      id: `${staffId}-${shiftDate}-${startsAt}`,
      shift_id: 'shift',
      staff_id: staffId,
      starts_at: startsAt,
      ends_at: endsAt,
      role: 'full',
      notes: null,
      created_at: '',
      updated_at: '',
    },
  };
}

describe('date helpers', () => {
  it('finds the Monday of a week', () => {
    expect(weekStartOf('2026-07-08')).toBe('2026-07-06'); // Wednesday → Monday
    expect(weekStartOf('2026-07-06')).toBe('2026-07-06'); // Monday → itself
    expect(weekStartOf('2026-07-12')).toBe('2026-07-06'); // Sunday → same week
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
  });
});

describe('assignmentHours', () => {
  it('computes fractional hours', () => {
    expect(assignmentHours('15:00:00', '20:30:00')).toBe(5.5);
    expect(assignmentHours('15:00', '16:00')).toBe(1);
  });
});

describe('rollupHours', () => {
  it('reproduces the sheet’s week of Jul 8–12 totals and % founders', () => {
    // The sheet's Shift Log for that week (founders: Wes, Julien).
    const rows = [
      assignment('wes', '2026-07-08', '15:00', '20:30'),
      assignment('julien', '2026-07-08', '15:00', '16:00'),
      assignment('julien', '2026-07-09', '15:00', '20:00'),
      assignment('omar', '2026-07-09', '15:00', '16:00'),
      assignment('wes', '2026-07-10', '14:00', '22:00'),
      assignment('omar', '2026-07-10', '14:00', '22:00'),
      assignment('julien', '2026-07-11', '09:00', '16:30'),
      assignment('althea', '2026-07-11', '09:00', '10:00'),
      assignment('wes', '2026-07-12', '12:00', '16:30'),
    ];

    const weeks = rollupHours(rows, new Set(['wes', 'julien']));
    expect(weeks).toHaveLength(1);

    const week = weeks[0];
    expect(week.weekStart).toBe('2026-07-06');
    expect(week.byStaff).toEqual({ wes: 18, julien: 13.5, omar: 9, althea: 1 });
    expect(week.total).toBe(41.5);
    expect(week.founderShare).toBeCloseTo(0.759, 3);
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]);
  });

  it('splits assignments into separate Monday-start weeks, sorted', () => {
    const weeks = rollupHours(
      [
        assignment('a', '2026-07-19', '12:00', '14:00'),
        assignment('a', '2026-07-20', '12:00', '14:00'),
      ],
      new Set()
    );
    // Jul 19 is a Sunday (week of Jul 13); Jul 20 the following Monday.
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-07-13', '2026-07-20']);
  });

  it('sums multiple same-day assignments and reports null founder share for empty weeks', () => {
    const weeks = rollupHours(
      [
        assignment('a', '2026-07-08', '09:00', '10:00'),
        assignment('a', '2026-07-08', '15:00', '16:30'),
      ],
      new Set()
    );
    expect(weeks[0].byStaff.a).toBe(2.5);
    expect(weeks[0].founderShare).toBe(0);
    expect(rollupHours([], new Set())).toEqual([]);
  });
});
