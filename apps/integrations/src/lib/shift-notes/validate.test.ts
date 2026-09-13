import { describe, expect, it } from 'vitest';
import {
  isNoteDate,
  NOTE_BODY_MAX,
  normalizeBody,
  normalizeReplyBody,
  REPLY_BODY_MAX,
} from './validate';

describe('isNoteDate', () => {
  it('accepts a real calendar date', () => {
    expect(isNoteDate('2026-08-21')).toBe(true);
    expect(isNoteDate('2028-02-29')).toBe(true); // leap day
  });

  it('rejects dates that only look plausible', () => {
    expect(isNoteDate('2026-02-31')).toBe(false);
    expect(isNoteDate('2026-13-01')).toBe(false);
    expect(isNoteDate('2027-02-29')).toBe(false); // not a leap year
  });

  it('rejects other shapes entirely', () => {
    expect(isNoteDate('08/21/2026')).toBe(false);
    expect(isNoteDate('2026-8-21')).toBe(false);
    expect(isNoteDate('')).toBe(false);
    expect(isNoteDate(20260821)).toBe(false);
    expect(isNoteDate(null)).toBe(false);
  });
});

describe('normalizeBody', () => {
  it('trims and returns a usable body', () => {
    expect(normalizeBody('  Busy night, tub 2 heater cycling.  ')).toBe(
      'Busy night, tub 2 heater cycling.'
    );
  });

  it('rejects empty and whitespace-only bodies', () => {
    expect(normalizeBody('')).toBeNull();
    expect(normalizeBody('   \n  ')).toBeNull();
  });

  it('rejects non-strings and over-length bodies', () => {
    expect(normalizeBody(42)).toBeNull();
    expect(normalizeBody(undefined)).toBeNull();
    expect(normalizeBody('x'.repeat(NOTE_BODY_MAX + 1))).toBeNull();
  });

  it('accepts a body exactly at the cap', () => {
    expect(normalizeBody('x'.repeat(NOTE_BODY_MAX))).toHaveLength(NOTE_BODY_MAX);
  });
});

describe('normalizeReplyBody', () => {
  it('trims and caps at the reply limit', () => {
    expect(normalizeReplyBody('  Ordered the part, in Thursday.  ')).toBe(
      'Ordered the part, in Thursday.'
    );
    expect(normalizeReplyBody('x'.repeat(REPLY_BODY_MAX))).toHaveLength(REPLY_BODY_MAX);
    expect(normalizeReplyBody('x'.repeat(REPLY_BODY_MAX + 1))).toBeNull();
  });

  it('rejects empty and non-string bodies', () => {
    expect(normalizeReplyBody('  ')).toBeNull();
    expect(normalizeReplyBody(null)).toBeNull();
  });
});
