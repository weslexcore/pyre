// Availability engine: expands time_off rows (trip ranges + recurring weekly
// patterns, optionally time-bounded) into concrete busy intervals for a given
// date, and classifies whether someone is free for a shift window. Pure
// functions over plain data — used server-side by the API routes and locally
// by the admin islands (same pattern as lib/water/recommendations), and
// pinned down in availability.test.ts.
//
// All dates are local YYYY-MM-DD strings and all times are local wall-clock
// 'HH:MM' / 'HH:MM:SS' strings; nothing here touches Date.now() or timezones
// beyond deriving the weekday of a calendar date.

import type { ShiftAssignmentRow, TimeOffRow } from '@/lib/db';

export const DAY_START_MIN = 0;
export const DAY_END_MIN = 24 * 60;

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

/** Minutes since midnight → 'HH:MM'. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Weekday of a YYYY-MM-DD calendar date: 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(date: string): number {
  // Parse as UTC so the host machine's timezone can't shift the calendar day.
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export interface BusyInterval {
  startMin: number;
  endMin: number;
  /** True when the entry has no time bounds — unavailable the whole day. */
  wholeDay: boolean;
  note: string | null;
  timeOffId: string;
}

/** The busy interval `entry` contributes on `date`, or null if it doesn't apply. */
export function busyIntervalOn(entry: TimeOffRow, date: string): BusyInterval | null {
  if (entry.kind === 'range') {
    if (!entry.start_date || !entry.end_date) return null;
    if (date < entry.start_date || date > entry.end_date) return null;
  } else {
    if (!entry.days_of_week.includes(dayOfWeek(date))) return null;
    if (entry.start_date && date < entry.start_date) return null;
    if (entry.end_date && date > entry.end_date) return null;
  }

  const wholeDay = entry.starts_at == null || entry.ends_at == null;
  return {
    startMin: wholeDay ? DAY_START_MIN : timeToMinutes(entry.starts_at as string),
    endMin: wholeDay ? DAY_END_MIN : timeToMinutes(entry.ends_at as string),
    wholeDay,
    note: entry.note,
    timeOffId: entry.id,
  };
}

/** All busy intervals for one staff member on one date. */
export function busyIntervalsFor(
  entries: TimeOffRow[],
  staffId: string,
  date: string
): BusyInterval[] {
  const intervals: BusyInterval[] = [];
  for (const entry of entries) {
    if (entry.staff_id !== staffId) continue;
    const interval = busyIntervalOn(entry, date);
    if (interval) intervals.push(interval);
  }
  return intervals;
}

export type AvailabilityStatus = 'free' | 'partial' | 'busy';

export interface Availability {
  status: AvailabilityStatus;
  /** The busy intervals that overlap the window (empty when free). */
  conflicts: BusyInterval[];
}

/**
 * Classify a staff member's availability for a window on a date:
 * 'busy' when busy intervals cover the whole window, 'partial' when they
 * overlap part of it, 'free' otherwise. Interval ends are exclusive, so
 * time off ending 14:30 doesn't conflict with a shift starting 14:30.
 */
export function availabilityFor(
  entries: TimeOffRow[],
  staffId: string,
  date: string,
  startMin: number,
  endMin: number
): Availability {
  const overlapping = busyIntervalsFor(entries, staffId, date).filter(
    (b) => b.startMin < endMin && b.endMin > startMin
  );
  if (overlapping.length === 0) return { status: 'free', conflicts: [] };

  // Walk merged coverage to see whether the window is fully covered.
  const sorted = [...overlapping].sort((a, b) => a.startMin - b.startMin);
  let covered = startMin;
  for (const b of sorted) {
    if (b.startMin > covered) break;
    covered = Math.max(covered, b.endMin);
  }

  return { status: covered >= endMin ? 'busy' : 'partial', conflicts: overlapping };
}

export interface AssignmentConflict {
  assignment: ShiftAssignmentRow;
  shiftDate: string;
  conflicts: BusyInterval[];
}

/**
 * Assignments that overlap the assignee's time off — surfaced as warnings in
 * the admin UI (time off auto-approves; nothing is unassigned automatically).
 */
export function findAssignmentConflicts(
  assignments: Array<{ assignment: ShiftAssignmentRow; shiftDate: string }>,
  entries: TimeOffRow[]
): AssignmentConflict[] {
  const result: AssignmentConflict[] = [];
  for (const { assignment, shiftDate } of assignments) {
    const availability = availabilityFor(
      entries,
      assignment.staff_id,
      shiftDate,
      timeToMinutes(assignment.starts_at),
      timeToMinutes(assignment.ends_at)
    );
    if (availability.status !== 'free') {
      result.push({ assignment, shiftDate, conflicts: availability.conflicts });
    }
  }
  return result;
}
