// Rest rule between days: whoever closes in the evening doesn't open the
// next morning. Advisory on the boards (they flag it, like the shift-lead
// rule) and a hard rule for the agent's drafts (the proposals route rejects
// them). The evening/opening cut-offs are wall-clock thresholds on the
// person's own hours, not the shift's label — a setup-only hour on the
// evening shift ends long before close and doesn't count.

import { timeToMinutes } from './availability';
import { addDays } from './hours';

/** An assignment ending at or after this is an evening shift (8pm). */
export const EVENING_SHIFT_ENDS_MIN = 20 * 60;
/** An assignment starting before this is an opening shift (10am). */
export const OPENING_SHIFT_STARTS_MIN = 10 * 60;

export function isEveningAssignment(endsAt: string): boolean {
  return timeToMinutes(endsAt) >= EVENING_SHIFT_ENDS_MIN;
}

export function isOpeningAssignment(startsAt: string): boolean {
  return timeToMinutes(startsAt) < OPENING_SHIFT_STARTS_MIN;
}

/** The slice of an assignment the rule reads; times are HH:MM or HH:MM:SS. */
export interface RestAssignment {
  staffId: string;
  date: string;
  startsAt: string;
  endsAt: string;
}

export interface RestViolation<T extends RestAssignment = RestAssignment> {
  staffId: string;
  /** The evening assignment, the day before. */
  evening: T;
  /** The opening assignment, the next day. */
  opening: T;
}

/**
 * Every (evening, next-day opening) pair on one person. Both sides come from
 * the same list, so pass existing and proposed assignments together to see
 * what a proposal would break.
 */
export function findRestViolations<T extends RestAssignment>(
  assignments: ReadonlyArray<T>
): RestViolation<T>[] {
  const openings = new Map<string, T[]>();
  for (const a of assignments) {
    if (!isOpeningAssignment(a.startsAt)) continue;
    const key = `${a.staffId}:${a.date}`;
    const list = openings.get(key) ?? [];
    list.push(a);
    openings.set(key, list);
  }

  const violations: RestViolation<T>[] = [];
  for (const evening of assignments) {
    if (!isEveningAssignment(evening.endsAt)) continue;
    const nextDay = openings.get(`${evening.staffId}:${addDays(evening.date, 1)}`) ?? [];
    for (const opening of nextDay) {
      violations.push({ staffId: evening.staffId, evening, opening });
    }
  }
  return violations;
}
