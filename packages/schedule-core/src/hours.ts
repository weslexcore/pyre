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
