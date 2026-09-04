import { describe, expect, it } from 'vitest';
import { isLastSessionOfDay } from './momence-events';

// All times America/New_York (EDT, UTC-4) on Sat 2026-06-20 unless noted.
const TEN_AM = '2026-06-20T14:00:00.000Z';
const NOON = '2026-06-20T16:00:00.000Z';
const THREE_PM = '2026-06-20T19:00:00.000Z';
const NEXT_DAY_ONE_PM = '2026-06-21T17:00:00.000Z';

describe('isLastSessionOfDay', () => {
  it('is false when another session starts later the same day', () => {
    expect(isLastSessionOfDay(NOON, [TEN_AM, NOON, THREE_PM])).toBe(false);
  });

  it('is true for the latest start of the day', () => {
    expect(isLastSessionOfDay(THREE_PM, [TEN_AM, NOON, THREE_PM, NEXT_DAY_ONE_PM])).toBe(true);
  });

  it('ignores earlier sessions and other days', () => {
    expect(isLastSessionOfDay(THREE_PM, [TEN_AM, NEXT_DAY_ONE_PM])).toBe(true);
  });

  it('compares days in bathhouse time, not UTC', () => {
    // 11:00 PM EDT Saturday is already Sunday in UTC; a Sunday 1 PM session
    // must not count as "later the same day".
    const latePm = '2026-06-21T03:00:00.000Z';
    expect(isLastSessionOfDay(latePm, [latePm, NEXT_DAY_ONE_PM])).toBe(true);
    // ...but a 9 PM EDT session on the same Saturday is not the last.
    const ninePm = '2026-06-21T01:00:00.000Z';
    expect(isLastSessionOfDay(ninePm, [ninePm, latePm])).toBe(false);
  });
});
