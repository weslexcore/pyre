import { createHash } from 'node:crypto';

// Minimal RFC 5545 generation for the two shapes we serve:
//
//   generateIcs         one booked customer session, times as UTC instants
//   generateIcsCalendar many staff shifts, times as America/New_York wall clock
//
// Hand-rolled instead of a library — fixed-structure VEVENTs don't justify a
// dependency, and the escaping/folding rules are a few lines each.

export interface CalendarEventData {
  title: string;
  /** ISO 8601 UTC */
  startIso: string;
  /** ISO 8601 UTC */
  endIso: string;
  location: string;
  description: string;
  url?: string;
}

/** '2026-06-20T14:00:00.000Z' -> '20260620T140000Z' */
export function toIcsUtc(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

// RFC 5545 §3.3.11: backslash, semicolon, and comma must be escaped in text
// values; newlines become a literal "\n".
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

// RFC 5545 §3.1: content lines longer than 75 octets must be folded with
// CRLF + one space. Chunking at 70 bytes keeps every line safely under the
// limit without measuring exact octet boundaries.
function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char) > 70) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
}

export function generateIcs(event: CalendarEventData): string {
  // Deterministic per session (start + title), so re-downloading the same link
  // updates the existing calendar entry instead of duplicating it.
  const uid = `pyre-${toIcsUtc(event.startIso)}-${createHash('sha256')
    .update(event.title)
    .digest('hex')
    .slice(0, 8)}@pyresauna.com`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pyre Sauna//Booking Confirmation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(event.startIso)}`,
    `DTEND:${toIcsUtc(event.endIso)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// Multi-event, wall-clock calendars (the staff shift feed)
// ---------------------------------------------------------------------------

export const ET_TZID = 'America/New_York';

// Shift rows store ET wall clock (a `date` column plus `time` columns, no
// zone), so the feed names that same wall clock with TZID rather than
// converting to an instant: `DTSTART;TZID=America/New_York:20260814T140000`
// is a direct concatenation of what's in the row. No conversion means no DST
// edge cases, and a 2pm shift stays 2pm if the rules ever change.
//
// Clients need the zone defined in-band. Post-2007 US rules (second Sunday in
// March / first Sunday in November) as an RRULE, so it stays correct for
// every year the feed covers without a table of transitions.
const ET_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${ET_TZID}`,
  `X-LIC-LOCATION:${ET_TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:20070311T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:20071104T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** ('2026-08-14', '14:00:00') -> '20260814T140000'. Pure string work. */
export function toIcsLocal(date: string, time: string): string {
  const [h = '00', m = '00', s = '00'] = time.split(':');
  return `${date.replace(/-/g, '')}T${h.padStart(2, '0')}${m.padStart(2, '0')}${s.padStart(2, '0')}`;
}

/** One event in a wall-clock calendar. Dates/times are ET, exactly as stored. */
export interface LocalCalendarEvent {
  /** Stable across edits — clients update the matching entry instead of duplicating. */
  uid: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM or HH:MM:SS */
  startTime: string;
  endTime: string;
  summary: string;
  location: string;
  description: string;
  url?: string;
  /** Defaults to CONFIRMED. */
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** ISO timestamp (row updated_at) — helps clients spot a changed event. */
  lastModified?: string;
}

/**
 * A subscribable VCALENDAR of wall-clock events. METHOD:PUBLISH with a whole
 * fresh event set on every fetch: clients replace what they hold, so removing
 * an event here removes it there.
 */
export function generateIcsCalendar(args: {
  /** Shown as the calendar's name in the subscriber's client. */
  calendarName: string;
  events: LocalCalendarEvent[];
}): string {
  const stamp = toIcsUtc(new Date().toISOString());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pyre Sauna//Staff Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(args.calendarName)}`,
    `X-WR-TIMEZONE:${ET_TZID}`,
    // Apple and Outlook honour these; Google polls on its own schedule.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...ET_VTIMEZONE,
    ...args.events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${ET_TZID}:${toIcsLocal(event.date, event.startTime)}`,
      `DTEND;TZID=${ET_TZID}:${toIcsLocal(event.date, event.endTime)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      ...(event.url ? [`URL:${event.url}`] : []),
      `STATUS:${event.status ?? 'CONFIRMED'}`,
      ...(event.lastModified ? [`LAST-MODIFIED:${toIcsUtc(event.lastModified)}`] : []),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];

  return `${lines.map(fold).join('\r\n')}\r\n`;
}
