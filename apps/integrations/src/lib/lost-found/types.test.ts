import { describe, expect, it } from 'vitest';
import { studioDateOf, studioDayWindow } from './types';

const NOW = new Date('2026-09-24T16:00:00.000Z'); // noon in New York

describe('studioDateOf', () => {
  it("reads the studio's calendar day, not UTC's", () => {
    // 01:00 UTC on the 22nd is still the evening of the 21st in New York.
    expect(studioDateOf(new Date('2026-09-22T01:00:00.000Z'))).toBe('2026-09-21');
  });
});

describe('studioDayWindow', () => {
  it('spans a whole past day, midnight to midnight in New York', () => {
    expect(studioDayWindow('2026-09-21', NOW)).toEqual({
      start: '2026-09-21T04:00:00.000Z',
      end: '2026-09-22T04:00:00.000Z',
    });
  });

  it('stops at now for today', () => {
    expect(studioDayWindow('2026-09-24', NOW)).toEqual({
      start: '2026-09-24T04:00:00.000Z',
      end: NOW.toISOString(),
    });
  });

  it('handles the short day when the clocks go forward', () => {
    const window = studioDayWindow('2026-03-08', NOW);
    expect(window).toEqual({
      start: '2026-03-08T05:00:00.000Z',
      end: '2026-03-09T04:00:00.000Z',
    });
  });

  it('handles the long day when the clocks go back', () => {
    expect(studioDayWindow('2026-11-01', new Date('2026-12-01T00:00:00.000Z'))).toEqual({
      start: '2026-11-01T04:00:00.000Z',
      end: '2026-11-02T05:00:00.000Z',
    });
  });

  it('refuses the future and junk', () => {
    expect(studioDayWindow('2026-09-25', NOW)).toBeNull();
    expect(studioDayWindow('yesterday', NOW)).toBeNull();
  });
});
