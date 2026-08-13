// The commitment horizon locks whole Monday–Sunday weeks: the rolling
// two-week mark rounds outward to the end of its week, so the confirmed
// window is always 14–20 days and tentative always starts on a Monday.

import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_HORIZON_DAYS,
  firstTentativeDate,
  isTentativeDate,
  lastConfirmedDate,
} from '../src/horizon';
import { addDays, weekStartOf } from '../src/hours';

describe('confirmed horizon', () => {
  // A Thursday: today+13 = Wed 2026-08-26, so the lock extends through that
  // week's Sunday (2026-08-30) and tentative starts Monday 2026-08-31.
  const today = '2026-08-13';

  it('locks through the Sunday completing the rolling two-week mark', () => {
    expect(CONFIRMED_HORIZON_DAYS).toBe(14);
    expect(lastConfirmedDate(today)).toBe('2026-08-30');
    expect(firstTentativeDate(today)).toBe('2026-08-31');
  });

  it('classifies dates around the boundary', () => {
    expect(isTentativeDate(today, today)).toBe(false);
    expect(isTentativeDate('2026-08-30', today)).toBe(false);
    expect(isTentativeDate('2026-08-31', today)).toBe(true);
    expect(isTentativeDate('2027-01-01', today)).toBe(true);
  });

  it('gives exactly 14 days when today is a Monday', () => {
    const monday = '2026-08-10';
    expect(firstTentativeDate(monday)).toBe('2026-08-24');
    expect(lastConfirmedDate(monday)).toBe('2026-08-23');
  });

  it('always starts tentative on a Monday, at least 14 days out', () => {
    for (let i = 0; i < 7; i++) {
      const day = addDays('2026-08-10', i);
      const boundary = firstTentativeDate(day);
      expect(weekStartOf(boundary)).toBe(boundary); // a Monday
      expect(boundary >= addDays(day, CONFIRMED_HORIZON_DAYS)).toBe(true);
      expect(boundary <= addDays(day, CONFIRMED_HORIZON_DAYS + 6)).toBe(true);
    }
  });

  it('treats past dates as history, not tentative', () => {
    expect(isTentativeDate('2026-08-12', today)).toBe(false);
    expect(isTentativeDate('2025-01-01', today)).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    // Fri 2026-12-25: +13 = Thu 2027-01-07, week ends Sun 2027-01-10.
    expect(firstTentativeDate('2026-12-25')).toBe('2027-01-11');
  });
});
