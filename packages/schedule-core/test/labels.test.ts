import { describe, expect, it } from 'vitest';
import { formatChipDate, formatCompactTime, formatShortDay } from '../src/labels';
import { easternDate } from '../src/tz';

describe('formatCompactTime', () => {
  it('drops :00 and uses a/p', () => {
    expect(formatCompactTime('09:00')).toBe('9a');
    expect(formatCompactTime('14:30:00')).toBe('2:30p');
    expect(formatCompactTime('00:05')).toBe('12:05a');
    expect(formatCompactTime('12:00')).toBe('12p');
  });
});

describe('date labels', () => {
  it('formats chip and short-day labels from a wall-clock date', () => {
    expect(formatChipDate('2026-09-02')).toBe('Wed 9/2');
    expect(formatShortDay('2026-08-17')).toBe('Mon, Aug 17');
  });
});

describe('easternDate', () => {
  it('is the ET calendar date across both DST offsets', () => {
    // 01:00Z is still the previous evening in New York, EDT or EST.
    expect(easternDate(new Date('2026-07-15T01:00:00Z'))).toBe('2026-07-14');
    expect(easternDate(new Date('2026-01-15T04:30:00Z'))).toBe('2026-01-14');
    expect(easternDate(new Date('2026-01-15T05:30:00Z'))).toBe('2026-01-15');
  });
});

describe('labels carried over from the integrations copies', () => {
  it('keeps their cases', () => {
    expect(formatCompactTime('16:00')).toBe('4p');
    expect(formatCompactTime('09:30')).toBe('9:30a');
    expect(formatChipDate('2026-12-25')).toBe('Fri 12/25');
    expect(formatShortDay('2026-08-20')).toBe('Thu, Aug 20');
  });
});
