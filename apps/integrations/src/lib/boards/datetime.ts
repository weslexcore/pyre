// A date & time answer: a day and a time on the bathhouse's wall clock,
// stored as 'YYYY-MM-DDTHH:MM' — the shape a datetime-local input speaks.
// Its own module so validate.ts and calendar.ts can both read it without
// importing each other.

import { isYmd } from '@/lib/goals/validate';

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](([01]\d|2[0-3]):[0-5]\d)(:\d{2}(\.\d+)?)?$/;

/**
 * A day and a time as 'YYYY-MM-DDTHH:MM', or null. The seconds some
 * browsers add and the space somebody types instead of the T are both
 * tidied away.
 */
export function dateTimeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = DATE_TIME_RE.exec(raw.trim());
  if (!match) return null;
  const [, date, time] = match;
  return isYmd(date) ? `${date}T${time}` : null;
}
