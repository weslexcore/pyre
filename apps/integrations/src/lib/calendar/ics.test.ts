// The .ics output is consumed by third-party calendar apps, so the RFC 5545
// wire format (CRLF, escaping, folding, UTC timestamps) gets pinned here.

import { describe, expect, it } from 'vitest';
import { type CalendarEventData, generateIcs, toIcsUtc } from './ics';

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
