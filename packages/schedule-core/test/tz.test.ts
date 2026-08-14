// The wall-clock <-> instant boundary. Shifts are stored as ET wall clock, so
// every conversion out to a real timestamp runs through here — and gets DST
// wrong silently if it drifts. The transition dates below are the real 2026
// US ones (Mar 8, Nov 1).

import { describe, expect, it } from 'vitest';
import { easternToUtc, utcToEastern } from '../src/tz';

describe('easternToUtc', () => {
  it('converts a winter (EST, UTC-5) wall clock', () => {
    expect(easternToUtc('2026-01-15', '14:00')).toBe('2026-01-15T19:00:00.000Z');
  });

  it('converts a summer (EDT, UTC-4) wall clock', () => {
    expect(easternToUtc('2026-08-14', '14:00')).toBe('2026-08-14T18:00:00.000Z');
  });

  it('accepts HH:MM:SS as well as HH:MM', () => {
    expect(easternToUtc('2026-08-14', '14:30:00')).toBe('2026-08-14T18:30:00.000Z');
  });

  it('handles midnight and end-of-day without rolling the date', () => {
    expect(easternToUtc('2026-08-14', '00:00')).toBe('2026-08-14T04:00:00.000Z');
    expect(easternToUtc('2026-08-14', '23:59')).toBe('2026-08-15T03:59:00.000Z');
  });

  it('uses the correct offset on either side of spring forward', () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT.
    expect(easternToUtc('2026-03-08', '01:00')).toBe('2026-03-08T06:00:00.000Z'); // EST, -5
    expect(easternToUtc('2026-03-08', '03:00')).toBe('2026-03-08T07:00:00.000Z'); // EDT, -4
  });

  it('resolves a wall clock inside the spring-forward gap to the later reading', () => {
    // 02:30 never happens on 2026-03-08; land on 03:30 EDT rather than throw.
    const iso = easternToUtc('2026-03-08', '02:30');
    expect(iso).toBe('2026-03-08T07:30:00.000Z');
    expect(utcToEastern(iso)).toEqual({ date: '2026-03-08', minutes: 3 * 60 + 30 });
  });

  it('resolves an ambiguous fall-back wall clock to the first occurrence', () => {
    // 01:30 happens twice on 2026-11-01; take the EDT one.
    expect(easternToUtc('2026-11-01', '01:30')).toBe('2026-11-01T05:30:00.000Z');
  });

  it('uses the correct offset on either side of fall back', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST.
    expect(easternToUtc('2026-11-01', '00:30')).toBe('2026-11-01T04:30:00.000Z'); // EDT, -4
    expect(easternToUtc('2026-11-01', '03:00')).toBe('2026-11-01T08:00:00.000Z'); // EST, -5
  });

  it('round-trips with utcToEastern across the year', () => {
    for (const date of ['2026-01-15', '2026-03-09', '2026-06-30', '2026-11-02', '2026-12-31']) {
      for (const time of ['06:00', '13:45', '21:30']) {
        const local = utcToEastern(easternToUtc(date, time));
        const [h, m] = time.split(':').map(Number);
        expect(local).toEqual({ date, minutes: h * 60 + m });
      }
    }
  });
});
