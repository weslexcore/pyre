// The commitment horizon: every Monday the schedule locks a run of days
// counted from that Monday — by default two weeks, the week that just started
// plus the week after, so the set-in-stone window ends on a Sunday and
// tentative starts on the Monday after next. Admins set the length on the
// board's Settings panel (schedule_settings.confirmed_horizon_days); every
// function here takes it, defaulting to the built-in two weeks. Beyond the
// horizon the schedule is a working plan: shifts are still created, drafted,
// and requested out there, and time off can be logged any distance ahead, but
// times and assignments may keep moving until the week locks. Purely a
// display/vocabulary boundary — nothing blocks edits on either side of it.

import { addDays, weekStartOf } from './hours';

/** Days locked from each Monday by default: that week plus the next. */
export const CONFIRMED_HORIZON_DAYS = 14;

/** Bounds for the admin setting: at least the current week, at most a quarter. */
export const MIN_CONFIRMED_HORIZON_DAYS = 7;
export const MAX_CONFIRMED_HORIZON_DAYS = 90;

/** True when a value is a whole number of days the setting accepts. */
export function isValidConfirmedHorizonDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_CONFIRMED_HORIZON_DAYS &&
    value <= MAX_CONFIRMED_HORIZON_DAYS
  );
}

/**
 * First date whose schedule is still tentative: horizonDays after the current
 * week's Monday (the Monday after next by default). Stable all week, then
 * advances a week every Monday.
 */
export function firstTentativeDate(
  today: string,
  horizonDays: number = CONFIRMED_HORIZON_DAYS
): string {
  return addDays(weekStartOf(today), horizonDays);
}

/** Last date (inclusive) the schedule is set in stone for. By default the
 * Sunday ending next week. */
export function lastConfirmedDate(
  today: string,
  horizonDays: number = CONFIRMED_HORIZON_DAYS
): string {
  return addDays(firstTentativeDate(today, horizonDays), -1);
}

/** True when a date's week hasn't locked yet. Past dates are history, never
 * tentative. */
export function isTentativeDate(
  date: string,
  today: string,
  horizonDays: number = CONFIRMED_HORIZON_DAYS
): boolean {
  return date >= firstTentativeDate(today, horizonDays);
}

/**
 * True when a shift is still tentative: its week hasn't locked AND no admin
 * has confirmed it by hand. A confirmed shift is set in stone however far
 * out it sits; inside the locked window the date rule alone settles it, so
 * clearing a confirmation there changes nothing.
 */
export function isTentativeShift(
  shift: { shift_date: string; confirmed_at: string | null },
  today: string,
  horizonDays: number = CONFIRMED_HORIZON_DAYS
): boolean {
  return !shift.confirmed_at && isTentativeDate(shift.shift_date, today, horizonDays);
}
