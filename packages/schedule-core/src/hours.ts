// Hours rollup for the /admin/schedule/hours report — per-person hours by
// date and by week, plus the sheet's "% founders" coverage metric. Weeks run
// Monday–Sunday. Pure functions, pinned down in hours.test.ts.

import type { StaffRow, ShiftAssignmentRow } from './types';
import { timeToMinutes } from './availability';

export function assignmentHours(startsAt: string, endsAt: string): number {
  return (timeToMinutes(endsAt) - timeToMinutes(startsAt)) / 60;
}

/** Monday of the week containing a YYYY-MM-DD date, as YYYY-MM-DD. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DayHours {
  date: string;
  byStaff: Record<string, number>;
  total: number;
}

export interface WeekHours {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  days: DayHours[];
  byStaff: Record<string, number>;
  total: number;
  /** Share of the week's hours worked by founders (0..1); null when no hours. */
  founderShare: number | null;
  /**
   * Stipend portion of byStaff, set by applyStipends() (see stipends.ts) —
   * already included in byStaff/total, kept separately for display.
   */
  stipendByStaff?: Record<string, number>;
}

/**
 * Group assignments into Monday–Sunday weeks with per-day and per-week hours
 * per staff id. `founderIds` drives the % founders metric.
 */
export function rollupHours(
  assignments: Array<{ assignment: ShiftAssignmentRow; shiftDate: string }>,
  founderIds: Set<string>
): WeekHours[] {
  const weeks = new Map<string, Map<string, Record<string, number>>>();

  for (const { assignment, shiftDate } of assignments) {
    const week = weekStartOf(shiftDate);
    let days = weeks.get(week);
    if (!days) {
      days = new Map();
      weeks.set(week, days);
    }
    let byStaff = days.get(shiftDate);
    if (!byStaff) {
      byStaff = {};
      days.set(shiftDate, byStaff);
    }
    byStaff[assignment.staff_id] =
      (byStaff[assignment.staff_id] ?? 0) +
      assignmentHours(assignment.starts_at, assignment.ends_at);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, dayMap]) => {
      const days: DayHours[] = [...dayMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, byStaff]) => ({
          date,
          byStaff,
          total: Object.values(byStaff).reduce((a, b) => a + b, 0),
        }));

      const byStaff: Record<string, number> = {};
      for (const day of days) {
        for (const [staffId, hours] of Object.entries(day.byStaff)) {
          byStaff[staffId] = (byStaff[staffId] ?? 0) + hours;
        }
      }
      const total = Object.values(byStaff).reduce((a, b) => a + b, 0);
      const founderHours = Object.entries(byStaff)
        .filter(([staffId]) => founderIds.has(staffId))
        .reduce((a, [, hours]) => a + hours, 0);

      return {
        weekStart,
        days,
        byStaff,
        total,
        founderShare: total > 0 ? founderHours / total : null,
      };
    });
}

export function founderIdsOf(staff: StaffRow[]): Set<string> {
  return new Set(staff.filter((s) => s.is_founder).map((s) => s.id));
}

/** staffId -> hourly rate for every row whose pay_rate survived redaction. */
export function payRatesOf(staff: Array<Pick<StaffRow, 'id' | 'pay_rate'>>): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const s of staff) if (s.pay_rate !== null) rates[s.id] = s.pay_rate;
  return rates;
}

/**
 * Amount due per person for one hours map (a week or a pay period): hours ×
 * rate, cents-rounded. Staff with no known rate (redacted for this viewer)
 * are omitted from byStaff AND the total — so a self-only viewer gets exactly
 * their own amount, and an admin (all rates known) gets true labor cost.
 */
export function amountsDue(
  hoursByStaff: Record<string, number>,
  rates: Record<string, number>
): { byStaff: Record<string, number>; total: number } {
  const byStaff: Record<string, number> = {};
  let total = 0;
  for (const [staffId, hours] of Object.entries(hoursByStaff)) {
    const rate = rates[staffId];
    if (rate === undefined) continue;
    const amount = Math.round(hours * rate * 100) / 100;
    byStaff[staffId] = amount;
    total += amount;
  }
  return { byStaff, total: Math.round(total * 100) / 100 };
}

/**
 * A payday Monday: pay runs bi-weekly in arrears, so this Monday's check
 * covers the two Monday-start weeks ending the day before.
 */
export const PAY_PERIOD_ANCHOR = '2026-08-17';

export interface PayPeriod {
  /** First Monday of the period (…2026-08-03, 2026-08-17, ± n×14 days…). */
  periodStart: string;
  /** Last covered day: the Sunday 13 days after periodStart. */
  periodEnd: string;
  /** periodStart + 14 days — the Monday this period is paid out. */
  payday: string;
  byStaff: Record<string, number>;
  total: number;
  founderShare: number | null;
  /** Weeks actually present in the input — 1 means the range clipped the period. */
  weekCount: number;
  /** Stipend portion of byStaff, present when any input week carried one. */
  stipendByStaff?: Record<string, number>;
}

/** Monday starting the bi-weekly pay period containing `date`. */
export function payPeriodStartOf(date: string, anchor = PAY_PERIOD_ANCHOR): string {
  const week = weekStartOf(date);
  const diffDays =
    (Date.parse(`${week}T00:00:00Z`) - Date.parse(`${weekStartOf(anchor)}T00:00:00Z`)) / 86_400_000;
  const weeksFromAnchor = Math.round(diffDays / 7);
  // Period starts sit at even week offsets from the anchor (which is both a
  // payday and a period start). ((x % 2) + 2) % 2 handles pre-anchor dates,
  // where JS % goes negative.
  return addDays(week, -7 * (((weeksFromAnchor % 2) + 2) % 2));
}

/** Collapse Monday-start weeks into two-week pay periods, sorted. */
export function groupIntoPayPeriods(weeks: WeekHours[], anchor = PAY_PERIOD_ANCHOR): PayPeriod[] {
  const buckets = new Map<string, WeekHours[]>();
  for (const week of weeks) {
    const start = payPeriodStartOf(week.weekStart, anchor);
    const bucket = buckets.get(start);
    if (bucket) bucket.push(week);
    else buckets.set(start, [week]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodStart, periodWeeks]) => {
      const byStaff: Record<string, number> = {};
      for (const week of periodWeeks) {
        for (const [staffId, hours] of Object.entries(week.byStaff)) {
          byStaff[staffId] = (byStaff[staffId] ?? 0) + hours;
        }
      }
      const total = Object.values(byStaff).reduce((a, b) => a + b, 0);
      // founderShare × total is a week's exact founder hours, so the merged
      // share needs no founderIds parameter.
      const founderHours = periodWeeks.reduce((a, w) => a + (w.founderShare ?? 0) * w.total, 0);

      let stipendByStaff: Record<string, number> | undefined;
      for (const week of periodWeeks) {
        if (!week.stipendByStaff) continue;
        stipendByStaff ??= {};
        for (const [staffId, hours] of Object.entries(week.stipendByStaff)) {
          stipendByStaff[staffId] = (stipendByStaff[staffId] ?? 0) + hours;
        }
      }

      return {
        periodStart,
        periodEnd: addDays(periodStart, 13),
        payday: addDays(periodStart, 14),
        byStaff,
        total,
        founderShare: total > 0 ? founderHours / total : null,
        weekCount: periodWeeks.length,
        ...(stipendByStaff !== undefined ? { stipendByStaff } : {}),
      };
    });
}
