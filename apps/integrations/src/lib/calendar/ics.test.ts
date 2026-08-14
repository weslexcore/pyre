// The .ics output is consumed by third-party calendar apps, so the RFC 5545
// wire format (CRLF, escaping, folding, UTC timestamps) gets pinned here.

import { describe, expect, it } from 'vitest';
import {
  type CalendarEventData,
  ET_TZID,
  generateIcs,
  generateIcsCalendar,
  type LocalCalendarEvent,
  toIcsLocal,
  toIcsUtc,
} from './ics';

const event = (over: Partial<CalendarEventData> = {}): CalendarEventData => ({
  title: 'Signature Guided Class',
  startIso: '2026-06-20T14:00:00.000Z',
  endIso: '2026-06-20T16:00:00.000Z',
  location: 'Pyre Sauna, 1000 Westover Hills Blvd, Richmond, VA 23225',
  description: 'Please arrive 10 minutes early.',
  url: 'https://pyresauna.com',
  ...over,
});

// Unfold (CRLF + space) to read logical lines back out.
const logicalLines = (ics: string) => ics.replace(/\r\n /g, '').trimEnd().split('\r\n');

describe('toIcsUtc', () => {
  it('converts ISO 8601 to compact UTC form', () => {
    expect(toIcsUtc('2026-06-20T14:00:00.000Z')).toBe('20260620T140000Z');
  });

  it('normalizes non-UTC offsets to Z', () => {
    expect(toIcsUtc('2026-06-20T10:00:00-04:00')).toBe('20260620T140000Z');
  });
});

describe('generateIcs', () => {
  it('uses CRLF line endings throughout, with a trailing CRLF', () => {
    const ics = generateIcs(event());
    expect(ics.endsWith('\r\n')).toBe(true);
    // No bare LF anywhere: removing CRLFs should leave no newline characters.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('emits the calendar and event structure', () => {
    const lines = logicalLines(generateIcs(event()));
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//Pyre Sauna//Booking Confirmation//EN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('DTSTART:20260620T140000Z');
    expect(lines).toContain('DTEND:20260620T160000Z');
    expect(lines).toContain('SUMMARY:Signature Guided Class');
    expect(lines).toContain('URL:https://pyresauna.com');
    expect(lines.at(-2)).toBe('END:VEVENT');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
  });

  it('escapes commas, semicolons, backslashes, and newlines in text fields', () => {
    const lines = logicalLines(
      generateIcs(event({ title: 'Sweat; Repeat, back\\slash', description: 'line one\nline two' }))
    );
    expect(lines).toContain('SUMMARY:Sweat\\; Repeat\\, back\\\\slash');
    expect(lines).toContain('DESCRIPTION:line one\\nline two');
  });

  it('folds lines over 75 octets with CRLF + space continuations', () => {
    const ics = generateIcs(event({ description: 'x'.repeat(200) }));
    const raw = ics.trimEnd().split('\r\n');
    const long = raw.filter((l) => Buffer.byteLength(l) > 75);
    expect(long).toEqual([]);
    const continuations = raw.filter((l) => l.startsWith(' '));
    expect(continuations.length).toBeGreaterThan(0);
    // Unfolding restores the full description.
    expect(logicalLines(ics)).toContain(`DESCRIPTION:${'x'.repeat(200)}`);
  });

  it('generates a deterministic UID from start time and title', () => {
    const uid = (ics: string) => logicalLines(ics).find((l) => l.startsWith('UID:'));
    const a = uid(generateIcs(event()));
    expect(a).toMatch(/^UID:pyre-20260620T140000Z-[0-9a-f]{8}@pyresauna\.com$/);
    expect(uid(generateIcs(event()))).toBe(a);
    expect(uid(generateIcs(event({ title: 'Different' })))).not.toBe(a);
  });

  it('omits URL when not provided', () => {
    const lines = logicalLines(generateIcs(event({ url: undefined })));
    expect(lines.some((l) => l.startsWith('URL:'))).toBe(false);
  });
});

describe('toIcsLocal', () => {
  it('packs a wall-clock date and time with no conversion', () => {
    expect(toIcsLocal('2026-08-14', '14:00:00')).toBe('20260814T140000');
  });

  it('accepts HH:MM and pads the seconds', () => {
    expect(toIcsLocal('2026-08-14', '9:05')).toBe('20260814T090500');
  });
});

describe('generateIcsCalendar', () => {
  const shiftEvent = (over: Partial<LocalCalendarEvent> = {}): LocalCalendarEvent => ({
    uid: 'pyre-shift-abc@pyresauna.com',
    date: '2026-08-14',
    startTime: '14:00:00',
    endTime: '20:30:00',
    summary: 'Pyre — Evening',
    location: 'Pyre Sauna, 1000 Westover Hills Blvd, Richmond, VA 23225',
    description: 'Evening, 2p–8:30p',
    url: 'https://example.test/admin/schedule',
    ...over,
  });

  const build = (events: LocalCalendarEvent[]) =>
    logicalLines(generateIcsCalendar({ calendarName: 'Pyre — My Shifts', events }));

  it('uses CRLF line endings throughout, with a trailing CRLF', () => {
    const ics = generateIcsCalendar({ calendarName: 'Pyre', events: [shiftEvent()] });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('advertises itself as a subscribable named calendar', () => {
    const lines = build([shiftEvent()]);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('PRODID:-//Pyre Sauna//Staff Schedule//EN');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('X-WR-CALNAME:Pyre — My Shifts');
    expect(lines).toContain(`X-WR-TIMEZONE:${ET_TZID}`);
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
  });

  it('carries exactly one VTIMEZONE, with the post-2007 US DST rules', () => {
    const lines = build([shiftEvent(), shiftEvent({ uid: 'b@pyresauna.com' })]);
    expect(lines.filter((l) => l === 'BEGIN:VTIMEZONE')).toHaveLength(1);
    expect(lines).toContain(`TZID:${ET_TZID}`);
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU');
    expect(lines).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU');
  });

  it('names wall-clock times with TZID and never emits a bare UTC DTSTART', () => {
    const lines = build([shiftEvent()]);
    expect(lines).toContain(`DTSTART;TZID=${ET_TZID}:20260814T140000`);
    expect(lines).toContain(`DTEND;TZID=${ET_TZID}:20260814T203000`);
    // A shift written as an instant would silently drift across DST.
    expect(lines.some((l) => /^DT(START|END):\d{8}T\d{6}Z$/.test(l))).toBe(false);
  });

  it('emits one VEVENT per event, defaulting STATUS to CONFIRMED', () => {
    const lines = build([shiftEvent(), shiftEvent({ uid: 'b@pyresauna.com' })]);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines.filter((l) => l === 'STATUS:CONFIRMED')).toHaveLength(2);
  });

  it('passes STATUS:CANCELLED through', () => {
    expect(build([shiftEvent({ status: 'CANCELLED' })])).toContain('STATUS:CANCELLED');
  });

  it('includes LAST-MODIFIED as a UTC stamp when given', () => {
    const lines = build([shiftEvent({ lastModified: '2026-08-13T14:22:11.000Z' })]);
    expect(lines).toContain('LAST-MODIFIED:20260813T142211Z');
  });

  it('escapes and folds long descriptions', () => {
    const ics = generateIcsCalendar({
      calendarName: 'Pyre',
      events: [shiftEvent({ description: `${'x'.repeat(200)}\nWith: Julien, Sunny` })],
    });
    expect(
      ics
        .trimEnd()
        .split('\r\n')
        .filter((l) => Buffer.byteLength(l) > 75)
    ).toEqual([]);
    expect(logicalLines(ics)).toContain(`DESCRIPTION:${'x'.repeat(200)}\\nWith: Julien\\, Sunny`);
  });

  it('stays a valid calendar with no events', () => {
    const lines = build([]);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines.some((l) => l === 'BEGIN:VEVENT')).toBe(false);
  });
});
