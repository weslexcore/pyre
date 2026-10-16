import { describe, expect, it } from 'vitest';
import { fillPlaceholders, normalizeTemplateName, placeholderValues } from './templates';

describe('placeholderValues', () => {
  it('fills today and the Monday-start weeks on the studio clock', () => {
    // Friday Oct 16, 2026, midday ET.
    expect(placeholderValues(new Date('2026-10-16T16:00:00Z'))).toEqual({
      '{{date}}': 'Oct 16',
      '{{week_of}}': 'Oct 12',
      '{{next_week_of}}': 'Oct 19',
    });
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(placeholderValues(new Date('2026-10-18T16:00:00Z'))['{{week_of}}']).toBe('Oct 12');
    expect(placeholderValues(new Date('2026-10-19T16:00:00Z'))['{{week_of}}']).toBe('Oct 19');
  });

  it('uses the studio date, not UTC, late in the evening', () => {
    // 11:30 PM ET Sunday is already Monday in UTC.
    expect(placeholderValues(new Date('2026-10-19T03:30:00Z'))).toMatchObject({
      '{{date}}': 'Oct 18',
      '{{week_of}}': 'Oct 12',
    });
  });

  it('crosses month and year boundaries', () => {
    expect(placeholderValues(new Date('2026-01-01T16:00:00Z'))['{{week_of}}']).toBe('Dec 29');
  });
});

describe('fillPlaceholders', () => {
  it('fills known placeholders, tolerates spacing, and leaves the rest alone', () => {
    const now = new Date('2026-10-16T16:00:00Z');
    expect(fillPlaceholders('Weekly update: week of {{week_of}}', now)).toBe(
      'Weekly update: week of Oct 12'
    );
    expect(fillPlaceholders('{{ date }} / {{unknown}} / {single}', now)).toBe(
      'Oct 16 / {{unknown}} / {single}'
    );
  });
});

describe('normalizeTemplateName', () => {
  it('trims and enforces the limit', () => {
    expect(normalizeTemplateName('  Weekly update ')).toBe('Weekly update');
    expect(normalizeTemplateName('')).toBe('');
    expect(normalizeTemplateName('x'.repeat(101))).toBe('');
    expect(normalizeTemplateName(3)).toBe('');
  });
});
