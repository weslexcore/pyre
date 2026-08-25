// Stipend math: recurring weekly hours with effective-date bounds and
// per-week overrides, folded into the hours rollup.

import { describe, expect, it } from 'vitest';
import { groupIntoPayPeriods, type WeekHours } from '../src/hours';
import { applyStipends, stipendHoursForWeek, stipendWeekHours } from '../src/stipends';
import type { StaffStipendRow, StipendOverrideRow } from '../src/types';

function stipend(
  id: string,
  staffId: string,
  hoursPerWeek: number,
  effectiveFrom: string,
  effectiveUntil: string | null = null
): StaffStipendRow {
  return {
    id,
    staff_id: staffId,
    label: `stipend ${id}`,
    hours_per_week: hoursPerWeek,
    effective_from: effectiveFrom,
    effective_until: effectiveUntil,
    created_at: '',
    updated_at: '',
  };
}

function override(stipendId: string, weekStart: string, hours: number): StipendOverrideRow {
  return {
    id: `${stipendId}-${weekStart}`,
    stipend_id: stipendId,
    week_start: weekStart,
    hours,
    note: null,
    created_at: '',
    updated_at: '',
  };
}

function week(weekStart: string, byStaff: Record<string, number>): WeekHours {
  return {
    weekStart,
    days: [],
    byStaff,
    total: Object.values(byStaff).reduce((a, b) => a + b, 0),
    founderShare: null,
  };
}

describe('stipendWeekHours', () => {
  const s = stipend('inv', 'sarah', 1, '2026-08-03', '2026-08-17');

  it('pays the default inside the effective range, inclusive of both ends', () => {
    expect(stipendWeekHours(s, '2026-08-03')).toBe(1);
    expect(stipendWeekHours(s, '2026-08-10')).toBe(1);
    expect(stipendWeekHours(s, '2026-08-17')).toBe(1);
  });

  it('pays nothing outside the effective range', () => {
    expect(stipendWeekHours(s, '2026-07-27')).toBe(0);
    expect(stipendWeekHours(s, '2026-08-24')).toBe(0);
  });

  it('runs open-ended when effective_until is null', () => {
    const open = stipend('ice', 'omar', 0.5, '2026-08-03');
    expect(stipendWeekHours(open, '2027-01-04')).toBe(0.5);
  });

  it('lets an override replace the default — including down to 0', () => {
    expect(stipendWeekHours(s, '2026-08-10', override('inv', '2026-08-10', 2.5))).toBe(2.5);
    expect(stipendWeekHours(s, '2026-08-10', override('inv', '2026-08-10', 0))).toBe(0);
  });

  it('ignores an override for a week outside the effective range', () => {
    expect(stipendWeekHours(s, '2026-08-24', override('inv', '2026-08-24', 3))).toBe(0);
  });
});

describe('stipendHoursForWeek', () => {
  it('sums a person’s stipends and omits zero rows', () => {
    const stipends = [
      stipend('inv', 'sarah', 1, '2026-08-03'),
      stipend('towels', 'sarah', 0.5, '2026-08-03'),
      stipend('ice', 'omar', 0.5, '2026-08-03'),
    ];
    const overrides = [override('ice', '2026-08-10', 0)];
    expect(stipendHoursForWeek(stipends, overrides, '2026-08-10')).toEqual({ sarah: 1.5 });
  });

  it('matches overrides by stipend AND week', () => {
    const stipends = [stipend('inv', 'sarah', 1, '2026-08-03')];
    const overrides = [override('inv', '2026-08-03', 2)];
    expect(stipendHoursForWeek(stipends, overrides, '2026-08-03')).toEqual({ sarah: 2 });
    expect(stipendHoursForWeek(stipends, overrides, '2026-08-10')).toEqual({ sarah: 1 });
  });
});

describe('applyStipends', () => {
  const stipends = [
    stipend('inv', 'sarah', 1, '2026-08-03'),
    stipend('ice', 'omar', 0.5, '2026-08-03'),
  ];

  it('adds stipend hours to existing weeks and keeps the portion separately', () => {
    const weeks = applyStipends(
      [week('2026-08-03', { sarah: 10, omar: 8 })],
      stipends,
      [],
      new Set(),
      '2026-08-03',
      '2026-08-09'
    );
    expect(weeks).toHaveLength(1);
    expect(weeks[0].byStaff).toEqual({ sarah: 11, omar: 8.5 });
    expect(weeks[0].total).toBe(19.5);
    expect(weeks[0].stipendByStaff).toEqual({ sarah: 1, omar: 0.5 });
  });

  it('creates a week that has stipend hours but no assignments', () => {
    const weeks = applyStipends([], stipends, [], new Set(), '2026-08-03', '2026-08-16');
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-08-03', '2026-08-10']);
    expect(weeks[0].byStaff).toEqual({ sarah: 1, omar: 0.5 });
    expect(weeks[0].days).toEqual([]);
  });

  it('covers every Monday week the range touches, even mid-week bounds', () => {
    // Aug 5 (Wed) – Aug 12 (Wed) touches the weeks of Aug 3 and Aug 10.
    const weeks = applyStipends([], stipends, [], new Set(), '2026-08-05', '2026-08-12');
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-08-03', '2026-08-10']);
  });

  it('applies overrides and leaves untouched weeks alone', () => {
    const input = [week('2026-07-27', { sarah: 5 })];
    const weeks = applyStipends(
      input,
      stipends,
      [override('inv', '2026-08-03', 2.5), override('ice', '2026-08-03', 0)],
      new Set(),
      '2026-08-03',
      '2026-08-09'
    );
    // The pre-range week passes through untouched (stipends start Aug 3)...
    expect(weeks[0]).toBe(input[0]);
    expect(input[0].byStaff).toEqual({ sarah: 5 });
    // ...and the overridden week pays 2.5 for Sarah and skips Omar entirely.
    expect(weeks[1].byStaff).toEqual({ sarah: 2.5 });
    expect(weeks[1].stipendByStaff).toEqual({ sarah: 2.5 });
  });

  it('recomputes founderShare over the merged totals', () => {
    const weeks = applyStipends(
      [week('2026-08-03', { wes: 9 })],
      [stipend('inv', 'sarah', 1, '2026-08-03')],
      [],
      new Set(['wes']),
      '2026-08-03',
      '2026-08-09'
    );
    expect(weeks[0].founderShare).toBeCloseTo(0.9, 6);
  });

  it('flows through groupIntoPayPeriods with the stipend portion aggregated', () => {
    const weeks = applyStipends(
      [week('2026-08-03', { sarah: 10 }), week('2026-08-10', { sarah: 12 })],
      [stipend('inv', 'sarah', 1, '2026-08-03')],
      [],
      new Set(),
      '2026-08-03',
      '2026-08-16'
    );
    const periods = groupIntoPayPeriods(weeks);
    expect(periods).toHaveLength(1);
    expect(periods[0].byStaff).toEqual({ sarah: 24 });
    expect(periods[0].stipendByStaff).toEqual({ sarah: 2 });
  });
});
