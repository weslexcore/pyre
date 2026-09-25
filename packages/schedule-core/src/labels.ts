// Compact wall-clock labels shared by the schedule board, notifications and
// emails. Inputs are already ET wall clock (a YYYY-MM-DD date, an HH:MM[:SS]
// time), so none of this converts timezones.

import { dayOfWeek, timeToMinutes } from './availability';
import { DOW_LABELS } from './constants';

/** '14:30' → '2:30p', '09:00:00' → '9a'. */
export function formatCompactTime(time: string): string {
  const min = timeToMinutes(time);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** '2026-09-02' → 'Wed 9/2'. */
export function formatChipDate(date: string): string {
  return `${DOW_LABELS[dayOfWeek(date)]} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
}

/** '2026-08-17' → 'Mon, Aug 17'. */
export function formatShortDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
