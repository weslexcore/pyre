import { createHash } from 'node:crypto';

// Minimal RFC 5545 generator for the one event shape we serve: a booked Pyre
// session. Hand-rolled instead of a library — a single fixed-structure VEVENT
// doesn't justify a dependency.

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
