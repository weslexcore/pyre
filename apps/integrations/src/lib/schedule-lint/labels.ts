// Display helpers shared by the rules, the email, and the tick summaries. All
// clock times are the bathhouse's (America/New_York), spelled with the zone
// so nobody reading on a phone set elsewhere has to guess.

import { formatClockTime, formatZoneAbbrev, TIME_ZONE } from '@/lib/momence-events';
import type { SessionRef } from './types';

/** "Thu, Sep 18" */
export function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TIME_ZONE,
  });
}

/** "Sep 18" — for the horizon end in a subject line. */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: TIME_ZONE,
  });
}

const dayKey = (d: Date): string => d.toLocaleDateString('en-US', { timeZone: TIME_ZONE });

/**
 * "Thu, Sep 18 · 6:00 PM – 9:00 PM EDT". When the event runs past midnight
 * the end carries its own day: "Fri, Sep 19 · 8:00 PM – Sat, Sep 20 2:00 AM EDT".
 */
export function formatWhenLabel(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const endPart =
    dayKey(start) === dayKey(end)
      ? formatClockTime(end)
      : `${formatDayLabel(endIso)} ${formatClockTime(end)}`;
  return `${formatDayLabel(startIso)} · ${formatClockTime(start)} – ${endPart} ${formatZoneAbbrev(start)}`;
}

/** "16:00" -> "4:00 PM"; a wall-clock setting, no zone involved. */
export function formatClockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "1 hour" / "2 hours" / "90 minutes" — a length setting, spelled how staff say it. */
export function formatDurationLabel(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** "3 booked" / "No bookings" / "" when the feed didn't say. */
export function bookingLabel(session: Pick<SessionRef, 'bookingCount'>): string {
  if (session.bookingCount === null) return '';
  if (session.bookingCount === 0) return 'No bookings';
  return `${session.bookingCount} booked`;
}

/** "Open hours" / "Social" / "Guided" — the canonical type, capitalised. */
export function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Same origin convention as the other email links: this app's deployment. */
export function appOrigin(): string {
  return import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
}
