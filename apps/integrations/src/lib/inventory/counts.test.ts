import { describe, expect, it } from 'vitest';
import {
  areaDueStatus,
  countEveryLabel,
  countTotals,
  DEFAULT_SETTINGS,
  defaultRoundName,
  itemDueStatus,
  itemLastCounted,
  needsReview,
} from './counts';

const now = new Date('2026-10-20T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('areaDueStatus', () => {
  it('is unscheduled without an interval', () => {
    expect(areaDueStatus(null, null, now)).toBe('unscheduled');
  });

  it('is due when never counted or past its interval, overdue past 1.5x', () => {
    expect(areaDueStatus(null, 7, now)).toBe('due');
    expect(areaDueStatus(daysAgo(3), 7, now)).toBe('ok');
    expect(areaDueStatus(daysAgo(7), 7, now)).toBe('due');
    expect(areaDueStatus(daysAgo(10), 7, now)).toBe('due');
    expect(areaDueStatus(daysAgo(11), 7, now)).toBe('overdue');
  });
});

describe('needsReview', () => {
  it('matches the database rule: over 20% of expected or over $25', () => {
    expect(needsReview(0, 10, 0, DEFAULT_SETTINGS)).toBe(false);
    expect(needsReview(-2, 20, -500, DEFAULT_SETTINGS)).toBe(false); // 10%, $5
    expect(needsReview(-2, 4, -3000, DEFAULT_SETTINGS)).toBe(true); // 50%
    expect(needsReview(-1, 40, -3000, DEFAULT_SETTINGS)).toBe(true); // 2.5% but $30
    expect(needsReview(3, 0, null, DEFAULT_SETTINGS)).toBe(true); // found from nothing
    expect(needsReview(-4, 20, null, DEFAULT_SETTINGS)).toBe(false); // exactly 20%
  });

  it('uses the configured thresholds', () => {
    expect(needsReview(-2, 20, -500, { review_pct: 5, review_cents: 100_000 })).toBe(true);
  });
});

describe('countTotals', () => {
  it('splits shortfall from found stock', () => {
    expect(
      countTotals([
        { variance: -2, variance_cents: -500 },
        { variance: 3, variance_cents: null },
        { variance: 0, variance_cents: 0 },
        { variance: -1, variance_cents: -1500 },
      ])
    ).toEqual({ shortUnits: 3, shortCents: 2000, foundUnits: 3, foundCents: 0 });
  });
});

describe('defaultRoundName', () => {
  it('names the round by the studio date', () => {
    expect(defaultRoundName(now)).toBe('Count – Oct 20');
  });
});

describe('itemDueStatus', () => {
  // 10:00 ET on Oct 3 (14:00Z).
  const now = new Date('2026-10-03T14:00:00Z');

  it('treats daily as once per studio day, however late the last count was', () => {
    expect(itemDueStatus('2026-10-03T12:30:00Z', 1, now)).toBe('ok'); // this morning
    expect(itemDueStatus('2026-10-03T03:30:00Z', 1, now)).toBe('due'); // 11:30pm ET yesterday
    expect(itemDueStatus('2026-10-02T21:00:00Z', 1, now)).toBe('due'); // yesterday evening
    expect(itemDueStatus('2026-10-01T15:00:00Z', 1, now)).toBe('overdue'); // two days ago
    expect(itemDueStatus(null, 1, now)).toBe('due');
  });

  it('counts weekly from the day of the last count', () => {
    expect(itemDueStatus('2026-09-28T15:00:00Z', 7, now)).toBe('ok');
    expect(itemDueStatus('2026-09-26T15:00:00Z', 7, now)).toBe('due');
    expect(itemDueStatus('2026-09-22T15:00:00Z', 7, now)).toBe('overdue');
  });
});

describe('itemLastCounted', () => {
  const last = new Map([
    ['a', '2026-10-02T10:00:00Z'],
    ['b', '2026-09-30T10:00:00Z'],
  ]);

  it('is the oldest spot, or never when a spot was never counted', () => {
    expect(itemLastCounted(['a', 'b'], last)).toBe('2026-09-30T10:00:00Z');
    expect(itemLastCounted(['a'], last)).toBe('2026-10-02T10:00:00Z');
    expect(itemLastCounted(['a', 'c'], last)).toBeNull();
    expect(itemLastCounted([], last)).toBeNull();
  });
});

describe('countEveryLabel', () => {
  it('names the common frequencies', () => {
    expect([1, 7, 14, 30, 3].map(countEveryLabel)).toEqual([
      'Daily',
      'Weekly',
      'Every 2 weeks',
      'Monthly',
      'Every 3 days',
    ]);
  });
});
