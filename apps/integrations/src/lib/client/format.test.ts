import { describe, expect, it } from 'vitest';
import { etStamp, etStampWithYear } from './format';

describe('etStamp', () => {
  it('formats on the studio clock, the same in every engine', () => {
    // 20:04 UTC on Aug 22 is 4:04 PM in Richmond (EDT).
    expect(etStamp('2026-08-22T20:04:00Z')).toBe('Aug 22, 4:04 PM');
    expect(etStampWithYear('2026-08-22T20:04:00Z')).toBe('Aug 22, 2026, 4:04 PM');
  });

  it('handles midnight, noon and standard time', () => {
    expect(etStamp('2026-11-18T05:00:00Z')).toBe('Nov 18, 12:00 AM');
    expect(etStamp('2026-11-18T17:30:00Z')).toBe('Nov 18, 12:30 PM');
  });

  it('never joins the date and time with "at"', () => {
    expect(etStamp('2026-11-18T20:32:00Z')).not.toContain(' at ');
  });
});
