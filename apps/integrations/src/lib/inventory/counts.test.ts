import { describe, expect, it } from 'vitest';
import {
  areaDueStatus,
  countTotals,
  DEFAULT_SETTINGS,
  defaultRoundName,
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
