// The commitment horizon: every Monday the schedule locks two weeks — the
// week that just started plus the week after. So the set-in-stone window
// always ends on a Sunday (8–14 days out depending on the day of week), and
// tentative always starts on the Monday after next. Beyond the horizon the
// schedule is a working plan: shifts are still created, drafted, and
// requested out there, and time off can be logged any distance ahead, but
// times and assignments may keep moving until the week locks. Purely a
// display/vocabulary boundary — nothing blocks edits on either side of it.

import { addDays, weekStartOf } from './hours';

/** Days locked from each Monday: that week plus the next. */
export const CONFIRMED_HORIZON_DAYS = 14;

/**
 * First date whose schedule is still tentative: the Monday after next,
 * counted from the current week's Monday. Stable all week, then advances a
 * week every Monday.
 */
export function firstTentativeDate(today: string): string {
  return addDays(weekStartOf(today), CONFIRMED_HORIZON_DAYS);
}

/** Last date (inclusive) the schedule is set in stone for. Always the Sunday
 * ending next week. */
export function lastConfirmedDate(today: string): string {
  return addDays(firstTentativeDate(today), -1);
}

/** True when a date's week hasn't locked yet. Past dates are history, never
 * tentative. */
export function isTentativeDate(date: string, today: string): boolean {
  return date >= firstTentativeDate(today);
}
