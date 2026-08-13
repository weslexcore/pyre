// The two-week commitment horizon: the schedule for the next two weeks is
// set in stone — staff can plan around it. Everything after is a working
// plan: shifts are still created, drafted, and requested out there, and time
// off can be logged any distance ahead, but times and assignments may keep
// moving until a date rolls inside the horizon. Purely a display/vocabulary
// boundary — nothing blocks edits on either side of it.

import { addDays } from './hours';

/** Days (including today) the published schedule is committed for. */
export const CONFIRMED_HORIZON_DAYS = 14;

/** Last date (inclusive) the schedule is set in stone for. */
export function lastConfirmedDate(today: string): string {
  return addDays(today, CONFIRMED_HORIZON_DAYS - 1);
}

/** First date whose schedule is still tentative. */
export function firstTentativeDate(today: string): string {
  return addDays(today, CONFIRMED_HORIZON_DAYS);
}

/** True when a date is beyond the two-week commitment horizon. Past dates are
 * history, never tentative. */
export function isTentativeDate(date: string, today: string): boolean {
  return date >= firstTentativeDate(today);
}
