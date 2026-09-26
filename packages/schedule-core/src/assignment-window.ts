// The hours a person gets by default when they're added to a shift. Nobody
// picks a "full" or "setup" shift any more — a person is on for the hours
// they're on — so the only question is when they arrive and when they leave.
// Both are schedule settings (minutes before the first session, minutes after
// the last), read at the moment someone is added: changing them moves the
// default for the next person, never the hours already on the board.

import { minutesToTime, timeToMinutes } from './availability';

/** Arrive this long before the first session unless the settings say otherwise. */
export const DEFAULT_ARRIVE_BEFORE_MIN = 90;
/** Stay this long after the last session unless the settings say otherwise. */
export const DEFAULT_LEAVE_AFTER_MIN = 30;
/** The most either setting may be — a longer lead is a different shift. */
export const MAX_SHIFT_BUFFER_MIN = 4 * 60;

export interface ShiftBufferSettings {
  arriveBeforeMin: number;
  leaveAfterMin: number;
}

export const DEFAULT_SHIFT_BUFFERS: ShiftBufferSettings = {
  arriveBeforeMin: DEFAULT_ARRIVE_BEFORE_MIN,
  leaveAfterMin: DEFAULT_LEAVE_AFTER_MIN,
};

/** The slice of a shift the default hours come from. */
export interface ShiftWindowEdges {
  starts_at: string;
  ends_at: string;
  /** First session's start when the shift opens for it; null for manual shifts and split cuts. */
  sessions_start_at?: string | null;
  /** Last session's end when the shift closes after it; null likewise. */
  sessions_end_at?: string | null;
}

const DAY_MIN = 24 * 60;

// Midnight reads as 23:59, the way the sync stores a window that runs to the
// end of the day — minutesToTime would wrap it to 00:00.
const toTime = (min: number) => minutesToTime(Math.min(min, DAY_MIN - 1));

/**
 * A new assignment's hours: the arrive-before lead ahead of the first session
 * and the leave-after buffer past the last one. An edge the shift has no
 * session for (a manual shift, either side of a split long day) stays at the
 * shift window's own edge. Always a non-empty span — a lead that would cross
 * the other edge falls back to the shift window.
 */
export function defaultAssignmentWindow(
  shift: ShiftWindowEdges,
  settings: ShiftBufferSettings = DEFAULT_SHIFT_BUFFERS
): { startsAt: string; endsAt: string } {
  const startMin = shift.sessions_start_at
    ? Math.max(0, timeToMinutes(shift.sessions_start_at) - settings.arriveBeforeMin)
    : timeToMinutes(shift.starts_at);
  const endMin = shift.sessions_end_at
    ? Math.min(DAY_MIN, timeToMinutes(shift.sessions_end_at) + settings.leaveAfterMin)
    : timeToMinutes(shift.ends_at);
  if (endMin <= startMin) {
    return { startsAt: shift.starts_at.slice(0, 5), endsAt: shift.ends_at.slice(0, 5) };
  }
  return { startsAt: toTime(startMin), endsAt: toTime(endMin) };
}
