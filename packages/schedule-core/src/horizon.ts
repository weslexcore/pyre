// The commitment horizon: the schedule locks whole Monday–Sunday weeks at a
// time, and always covers at least the next two weeks — the rolling
// two-week mark rounds outward to the Sunday that completes its week, so
// tentative always starts on a Monday and a week is either entirely set in
// stone or entirely tentative. Beyond the horizon the schedule is a working
// plan: shifts are still created, drafted, and requested out there, and time
// off can be logged any distance ahead, but times and assignments may keep
// moving until the week locks. Purely a display/vocabulary boundary —
// nothing blocks edits on either side of it.

import { addDays, weekStartOf } from './hours';

/** Minimum days (including today) the published schedule is committed for. */
export const CONFIRMED_HORIZON_DAYS = 14;

/**
 * First date whose schedule is still tentative: the Monday after the week
 * containing the rolling two-week mark. Always a Monday, 14–20 days out.
 */
export function firstTentativeDate(today: string): string {
  return addDays(weekStartOf(addDays(today, CONFIRMED_HORIZON_DAYS - 1)), 7);
}

/** Last date (inclusive) the schedule is set in stone for. Always a Sunday. */
export function lastConfirmedDate(today: string): string {
  return addDays(firstTentativeDate(today), -1);
}

/** True when a date's week hasn't locked yet. Past dates are history, never
 * tentative. */
export function isTentativeDate(date: string, today: string): boolean {
  return date >= firstTentativeDate(today);
}
