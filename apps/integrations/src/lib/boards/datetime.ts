// A date & time answer: a day on the bathhouse's wall clock, and the time on
// it when one is known — 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'. The time is
// optional per answer, so a field can hold a booked evening at 6:30 beside a
// day whose hour nobody has agreed yet. Its own module so validate.ts and
// calendar.ts can both read it without importing each other.

import { isYmd } from '@/lib/goals/validate';

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](([01]\d|2[0-3]):[0-5]\d)(:\d{2}(\.\d+)?)?)?$/;

/**
 * A day as 'YYYY-MM-DD', or a day and a time as 'YYYY-MM-DDTHH:MM', or null.
 * The seconds some browsers add and the space somebody types instead of the
 * T are both tidied away.
 */
export function dateTimeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = DATE_TIME_RE.exec(raw.trim());
  if (!match) return null;
  const [, date, time] = match;
  if (!isYmd(date)) return null;
  return time ? `${date}T${time}` : date;
}

/** The time in a date & time answer, or null when it is a day alone. */
export function timeOfDateTime(value: string): string | null {
  return value.length > 10 ? value.slice(11) : null;
}
