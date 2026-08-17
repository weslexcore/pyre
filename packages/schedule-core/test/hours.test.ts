// Hours rollup: verified against the sheet's own "Total Hours" numbers for
// the week of Jul 8–12, 2026 (including the 0.759 "% founders" cell).

import { describe, expect, it } from 'vitest';
import type { ShiftAssignmentRow } from '../src/types';
import {
  type WeekHours,
  addDays,
  amountsDue,
  assignmentHours,
  groupIntoPayPeriods,
  payPeriodStartOf,
  payRatesOf,
  rollupHours,
  weekStartOf,
} from '../src/hours';

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
      proposal_id: null,
      is_draft: false,
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

describe('payRatesOf', () => {
  it('maps ids to rates, skipping redacted (null) rows', () => {
    expect(
      payRatesOf([
        { id: 'wes', pay_rate: 0 },
        { id: 'omar', pay_rate: 22.5 },
        { id: 'althea', pay_rate: null },
      ])
    ).toEqual({ wes: 0, omar: 22.5 });
  });
});

describe('amountsDue', () => {
  it('multiplies hours by rate with cents rounding', () => {
    // 5.5h × $17.25 = $94.875 → $94.88
    const { byStaff, total } = amountsDue({ omar: 5.5 }, { omar: 17.25 });
    expect(byStaff.omar).toBe(94.88);
    expect(total).toBe(94.88);
  });

  it('omits staff without a known rate from byStaff and the total', () => {
    const { byStaff, total } = amountsDue({ omar: 10, althea: 10 }, { omar: 20 });
    expect(byStaff).toEqual({ omar: 200 });
    expect(total).toBe(200);
  });

  it('counts a rate-0 founder as $0 and handles empty inputs', () => {
    expect(amountsDue({ wes: 18 }, { wes: 0 })).toEqual({ byStaff: { wes: 0 }, total: 0 });
    expect(amountsDue({}, {})).toEqual({ byStaff: {}, total: 0 });
  });
});

describe('payPeriodStartOf', () => {
  // Anchor: 2026-08-17 is a payday Monday, so periods start on 2026-08-03,
  // 2026-08-17, and every 14 days either direction.
  it('maps dates onto the bi-weekly lattice around the anchor', () => {
    expect(payPeriodStartOf('2026-08-17')).toBe('2026-08-17'); // anchor → itself
    expect(payPeriodStartOf('2026-08-16')).toBe('2026-08-03'); // Sunday before payday
    expect(payPeriodStartOf('2026-08-10')).toBe('2026-08-03'); // second week of period
    expect(payPeriodStartOf('2026-08-03')).toBe('2026-08-03'); // period start → itself
    expect(payPeriodStartOf('2026-08-20')).toBe('2026-08-17'); // mid-week → its period Monday
  });

  it('handles dates before the anchor (negative modulo)', () => {
    expect(payPeriodStartOf('2026-07-27')).toBe('2026-07-20');
    expect(payPeriodStartOf('2026-07-20')).toBe('2026-07-20');
    expect(payPeriodStartOf('2026-07-19')).toBe('2026-07-06');
  });
});

describe('groupIntoPayPeriods', () => {
  const week = (weekStart: string, byStaff: Record<string, number>, founderShare: number | null = null): WeekHours => {
    const total = Object.values(byStaff).reduce((a, b) => a + b, 0);
    return { weekStart, days: [], byStaff, total, founderShare };
  };

  it('merges the two weeks of a period and stamps its dates', () => {
    const periods = groupIntoPayPeriods([
      week('2026-08-03', { wes: 10, omar: 8 }),
      week('2026-08-10', { omar: 4, althea: 2 }),
    ]);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      periodStart: '2026-08-03',
      periodEnd: '2026-08-16',
      payday: '2026-08-17',
      byStaff: { wes: 10, omar: 12, althea: 2 },
      total: 24,
      weekCount: 2,
    });
  });

  it('keeps weeks in different periods separate, sorted', () => {
    const periods = groupIntoPayPeriods([
      week('2026-08-17', { a: 1 }),
      week('2026-08-10', { a: 1 }),
      week('2026-08-03', { a: 1 }),
    ]);
    expect(periods.map((p) => p.periodStart)).toEqual(['2026-08-03', '2026-08-17']);
    expect(periods.map((p) => p.weekCount)).toEqual([2, 1]);
  });

  it('recomputes founderShare weighted by week totals', () => {
    // Week 1: 10h at 50% founders (5 founder hours); week 2: 30h at 100%.
    const periods = groupIntoPayPeriods([
      week('2026-08-03', { wes: 5, omar: 5 }, 0.5),
      week('2026-08-10', { wes: 30 }, 1),
    ]);
    expect(periods[0].founderShare).toBeCloseTo(35 / 40, 6);
  });

  it('returns null founderShare for zero-hour periods and [] for empty input', () => {
    expect(groupIntoPayPeriods([week('2026-08-03', {})])[0].founderShare).toBeNull();
    expect(groupIntoPayPeriods([])).toEqual([]);
  });
});
