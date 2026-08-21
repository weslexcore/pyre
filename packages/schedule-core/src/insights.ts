// Staffing insights for /admin/schedule/insights: per-person consistency
// stats against their own weekly target, and coverage-window hours for the
// cost-per-open-hour metric. Pure functions over rollupHours output, pinned
// down in insights.test.ts.

import { addDays, assignmentHours, weekStartOf, type WeekHours } from './hours';
import type { ShiftRow, StaffRow } from './types';
import { DEFAULT_WINDOW_OPTIONS } from './windows';

/** Mondays of the last `count` COMPLETED Mon–Sun weeks (current week excluded). */
export function completedWeekStarts(today: string, count = 8): string[] {
  const thisWeek = weekStartOf(today);
  return Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - i)));
}

/** Flag thresholds — exported so tests and UI copy stay in sync. */
export const UNDER_TARGET_RATIO = 0.8; // avg < 80% of target → under-target
export const INCONSISTENT_CV = 0.5; // stddev/avg > 0.5 → choppy weeks

export interface ConsistencyRow {
  staffId: string;
  /**
   * Hours per week since the person joined, 0-filled, aligned with the TAIL
   * of the weekStarts input — weeks before they existed are excluded rather
   * than counted as zeros, so a recent hire's stats aren't dragged down by
   * weeks they couldn't have worked. Empty for someone who joined this week.
   */
  weekly: number[];
  /** Weeks actually covered (weekly.length) — fewer than the window = recent hire. */
  weeksTracked: number;
  avg: number;
  min: number;
  max: number;
  stddev: number;
  target: number | null;
  /** Weeks strictly below target; null when no target. */
  weeksUnderTarget: number | null;
  /** Target set and avg < UNDER_TARGET_RATIO × target. */
  underTarget: boolean;
  /** avg > 0 and stddev/avg > INCONSISTENT_CV. */
  inconsistent: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Per-person weekly-hours stats over a fixed window. rollupHours omits empty
 * weeks, so hours are re-aligned to `weekStarts` with zero-fill — a person
 * with a target and no recent hours still gets a (maximally flagged) row.
 *
 * Each person's window is clipped to when they joined: weeks before the
 * EARLIER of their staff row's creation and their first week with hours are
 * excluded, not zero-filled (created_at alone would hide history for people
 * whose rows were back-imported after their real first shift). Zeros after
 * joining still count — those are real under-scheduling signal.
 *
 * Returns a row for every staff entry passed in; callers filter.
 */
export function consistencyStats(
  weeks: WeekHours[],
  weekStarts: string[],
  staff: Array<Pick<StaffRow, 'id' | 'target_hours_per_week' | 'created_at'>>
): ConsistencyRow[] {
  const byWeek = new Map(weeks.map((w) => [w.weekStart, w.byStaff]));

  return staff.map(({ id, target_hours_per_week: target, created_at }) => {
    const firstHoursWeek = weekStarts.find((ws) => (byWeek.get(ws)?.[id] ?? 0) > 0) ?? null;
    const createdWeek = weekStartOf(created_at.slice(0, 10));
    const joinedWeek =
      firstHoursWeek !== null && firstHoursWeek < createdWeek ? firstHoursWeek : createdWeek;

    const trackedStarts = weekStarts.filter((ws) => ws >= joinedWeek);
    const weekly = trackedStarts.map((ws) => round1(byWeek.get(ws)?.[id] ?? 0));
    const count = weekly.length;
    const avg = count > 0 ? weekly.reduce((a, b) => a + b, 0) / count : 0;
    const variance = count > 0 ? weekly.reduce((a, h) => a + (h - avg) ** 2, 0) / count : 0;
    const stddev = Math.sqrt(variance);

    return {
      staffId: id,
      weekly,
      weeksTracked: count,
      avg: round1(avg),
      min: count > 0 ? Math.min(...weekly) : 0,
      max: count > 0 ? Math.max(...weekly) : 0,
      stddev: round1(stddev),
      target,
      weeksUnderTarget: target == null ? null : weekly.filter((h) => h < target).length,
      underTarget: count > 0 && target != null && avg < UNDER_TARGET_RATIO * target,
      inconsistent: avg > 0 && stddev / avg > INCONSISTENT_CV,
    };
  });
}

/**
 * Customer-facing (revenue-generating) hours per Monday week — the
 * denominator for "labor cost per open hour", which tells you the revenue
 * per open hour needed to break even on labor.
 *
 * Only Momence-synced shifts count: all sessions live in Momence, and
 * manual shifts are maintenance/other non-revenue work — they contribute 0
 * open hours (their labor still lands in the cost numerator, where it
 * belongs). Synced windows include staff-only padding (deriveCoverageWindows
 * pads leadMin before the first session and closeMin after the last), so
 * each is trimmed back to first-session-start → last-session-end and floored
 * at zero. Deliberately NOT × staff_needed: it measures hours customers can
 * be paying, not demanded staff-hours.
 */
export function openHoursByWeek(
  shifts: Array<Pick<ShiftRow, 'shift_date' | 'starts_at' | 'ends_at' | 'status' | 'source'>>
): Record<string, number> {
  const padHours = (DEFAULT_WINDOW_OPTIONS.leadMin + DEFAULT_WINDOW_OPTIONS.closeMin) / 60;
  const hours: Record<string, number> = {};
  for (const shift of shifts) {
    if (shift.status !== 'active' || shift.source !== 'momence') continue;
    const week = weekStartOf(shift.shift_date);
    const open = Math.max(0, assignmentHours(shift.starts_at, shift.ends_at) - padHours);
    hours[week] = (hours[week] ?? 0) + open;
  }
  return hours;
}

/**
 * Daily-grain twin of openHoursByWeek, keyed by shift_date — for callers that
 * re-bucket into arbitrary ranges (day/week/month) at read time. Same rules:
 * only active Momence-synced shifts count, each trimmed of the staff-only
 * lead/close padding and floored at zero.
 */
export function openHoursByDay(
  shifts: Array<Pick<ShiftRow, 'shift_date' | 'starts_at' | 'ends_at' | 'status' | 'source'>>
): Record<string, number> {
  const padHours = (DEFAULT_WINDOW_OPTIONS.leadMin + DEFAULT_WINDOW_OPTIONS.closeMin) / 60;
  const hours: Record<string, number> = {};
  for (const shift of shifts) {
    if (shift.status !== 'active' || shift.source !== 'momence') continue;
    const open = Math.max(0, assignmentHours(shift.starts_at, shift.ends_at) - padHours);
    hours[shift.shift_date] = (hours[shift.shift_date] ?? 0) + open;
  }
  return hours;
}
