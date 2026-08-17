import { describe, expect, it } from 'vitest';
import type { WeekHours } from '../src/hours';
import {
  INCONSISTENT_CV,
  UNDER_TARGET_RATIO,
  completedWeekStarts,
  consistencyStats,
  openHoursByWeek,
} from '../src/insights';

const week = (weekStart: string, byStaff: Record<string, number>): WeekHours => ({
  weekStart,
  days: [],
  byStaff,
  total: Object.values(byStaff).reduce((a, b) => a + b, 0),
  founderShare: null,
});

describe('completedWeekStarts', () => {
  it('lists the Mondays of the last N completed weeks, oldest first', () => {
    // 2026-08-17 is a Monday; its week is in progress, so the window ends 8/10.
    expect(completedWeekStarts('2026-08-17', 3)).toEqual([
      '2026-07-27',
      '2026-08-03',
      '2026-08-10',
    ]);
  });

  it('excludes the current week for a mid-week today', () => {
    expect(completedWeekStarts('2026-08-20', 2)).toEqual(['2026-08-03', '2026-08-10']);
  });
});

describe('consistencyStats', () => {
  const weekStarts = ['2026-08-03', '2026-08-10'];
  // Predates every window in these tests — a long-tenured person.
  const OLD = '2026-06-01T00:00:00Z';
  const person = (id: string, target: number | null, createdAt = OLD) => ({
    id,
    target_hours_per_week: target,
    created_at: createdAt,
  });

  it('aligns hours to the window and zero-fills missing weeks', () => {
    // omar only appears in the first week; the second is zero-filled.
    const [row] = consistencyStats([week('2026-08-03', { omar: 10 })], weekStarts, [
      person('omar', null),
    ]);
    expect(row.weekly).toEqual([10, 0]);
    expect(row.weeksTracked).toBe(2);
    expect(row.avg).toBe(5);
    expect(row.min).toBe(0);
    expect(row.max).toBe(10);
  });

  it('gives a maximally flagged row to a targeted long-tenured person with no hours', () => {
    const [row] = consistencyStats([], weekStarts, [person('sunny', 20)]);
    expect(row.weekly).toEqual([0, 0]);
    expect(row.underTarget).toBe(true);
    expect(row.weeksUnderTarget).toBe(2);
    expect(row.inconsistent).toBe(false); // no hours = flat, not choppy
  });

  it('excludes weeks before a recent hire joined instead of zero-filling them', () => {
    // Added mid-window, worked their one week since: no leading zeros, no
    // under-target flag from weeks they couldn't have worked.
    const weeks = [week('2026-08-10', { newbie: 18 })];
    const [row] = consistencyStats(weeks, weekStarts, [
      person('newbie', 20, '2026-08-12T09:00:00Z'),
    ]);
    expect(row.weekly).toEqual([18]);
    expect(row.weeksTracked).toBe(1);
    expect(row.avg).toBe(18);
    expect(row.underTarget).toBe(false); // 18 ≥ 0.8 × 20
  });

  it('trusts first-hours over created_at for back-imported people', () => {
    // Row created 8/12 but hours exist from 8/3 (sheet import) — the real
    // history wins and the whole window counts.
    const weeks = [week('2026-08-03', { vet: 10 })];
    const [row] = consistencyStats(weeks, weekStarts, [person('vet', null, '2026-08-12T09:00:00Z')]);
    expect(row.weekly).toEqual([10, 0]);
    expect(row.weeksTracked).toBe(2);
  });

  it('returns an unflagged empty row for someone who joined after the window', () => {
    const [row] = consistencyStats([], weekStarts, [person('brand-new', 20, '2026-08-17T09:00:00Z')]);
    expect(row.weekly).toEqual([]);
    expect(row.weeksTracked).toBe(0);
    expect(row.avg).toBe(0);
    expect(row.underTarget).toBe(false);
    expect(row.inconsistent).toBe(false);
  });

  it('flags under-target at the ratio boundary', () => {
    const weeks = [week('2026-08-03', { a: 15, b: 16 }), week('2026-08-10', { a: 15, b: 16 })];
    const rows = consistencyStats(weeks, weekStarts, [
      person('a', 20), // avg 15 < 0.8 × 20 → flagged
      person('b', 20), // avg 16 = 0.8 × 20 → not flagged
    ]);
    expect(UNDER_TARGET_RATIO).toBe(0.8);
    expect(rows[0].underTarget).toBe(true);
    expect(rows[1].underTarget).toBe(false);
  });

  it('flags choppy weeks via coefficient of variation, never people without a target', () => {
    // 20 then 0: avg 10, stddev 10, cv 1 > 0.5 → inconsistent, but no
    // target means no under-target flag.
    const weeks = [week('2026-08-03', { a: 20 }), week('2026-08-10', { a: 0 })];
    const [row] = consistencyStats(weeks, weekStarts, [person('a', null)]);
    expect(INCONSISTENT_CV).toBe(0.5);
    expect(row.inconsistent).toBe(true);
    expect(row.underTarget).toBe(false);
    expect(row.weeksUnderTarget).toBeNull();
  });

  it('counts weeks strictly below target', () => {
    const weeks = [week('2026-08-03', { a: 20 }), week('2026-08-10', { a: 19.5 })];
    const [row] = consistencyStats(weeks, weekStarts, [person('a', 20)]);
    expect(row.weeksUnderTarget).toBe(1);
  });
});

describe('openHoursByWeek', () => {
  const shift = (
    date: string,
    startsAt: string,
    endsAt: string,
    status: 'active' | 'cancelled' = 'active',
    source: 'momence' | 'manual' = 'momence'
  ) => ({ shift_date: date, starts_at: startsAt, ends_at: endsAt, status, source });

  it('trims staff-only padding to customer-facing hours, skipping cancelled shifts', () => {
    // Windows carry 1.5h setup + 0.5h shutdown of staff-only time, so a
    // 15:00–21:00 shift is 4 revenue hours (16:30 first session → 20:30 last
    // session end).
    expect(
      openHoursByWeek([
        shift('2026-08-05', '15:00', '21:00'),
        shift('2026-08-08', '09:00', '16:30'),
        shift('2026-08-12', '15:00', '21:00', 'cancelled'),
      ])
    ).toEqual({ '2026-08-03': 9.5 });
  });

  it('counts manual (maintenance) shifts as zero revenue hours', () => {
    // No session attached — sessions only exist in Momence — so a hand-made
    // shift never adds sellable time, however long it runs.
    expect(
      openHoursByWeek([
        shift('2026-08-05', '15:00', '21:00'),
        shift('2026-08-06', '08:00', '18:00', 'active', 'manual'),
      ])
    ).toEqual({ '2026-08-03': 4 });
  });

  it('floors windows shorter than the padding at zero revenue hours', () => {
    expect(openHoursByWeek([shift('2026-08-13', '15:00', '17:00')])).toEqual({ '2026-08-10': 0 });
  });
});
