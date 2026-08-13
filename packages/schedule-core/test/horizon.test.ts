// The commitment horizon: every Monday locks two whole Mon–Sun weeks — the
// week that just started plus the week after. The boundary is stable all
// week and advances a week each Monday.

import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_HORIZON_DAYS,
  firstTentativeDate,
  isTentativeDate,
  lastConfirmedDate,
} from '../src/horizon';
import { addDays, weekStartOf } from '../src/hours';

describe('confirmed horizon', () => {
  // Thu 2026-08-13: its week began Mon 8/10, so 8/10 + 14 days locked —
  // through Sun 8/23, tentative from Mon 8/24.
  const today = '2026-08-13';

  it('locks the current week plus the next', () => {
    expect(CONFIRMED_HORIZON_DAYS).toBe(14);
    expect(lastConfirmedDate(today)).toBe('2026-08-23');
    expect(firstTentativeDate(today)).toBe('2026-08-24');
  });

  it('classifies dates around the boundary', () => {
    expect(isTentativeDate(today, today)).toBe(false);
    expect(isTentativeDate('2026-08-23', today)).toBe(false);
    expect(isTentativeDate('2026-08-24', today)).toBe(true);
    expect(isTentativeDate('2027-01-01', today)).toBe(true);
  });

  it('holds the same boundary all week, advancing on Monday', () => {
    for (let i = 0; i < 7; i++) {
      expect(firstTentativeDate(addDays('2026-08-10', i))).toBe('2026-08-24');
    }
    expect(firstTentativeDate('2026-08-17')).toBe('2026-08-31');
  });

  it('always starts tentative on a Monday', () => {
    for (let i = 0; i < 7; i++) {
      const boundary = firstTentativeDate(addDays('2026-08-10', i));
      expect(weekStartOf(boundary)).toBe(boundary);
    }
  });

  it('treats past dates as history, not tentative', () => {
    expect(isTentativeDate('2026-08-09', today)).toBe(false);
    expect(isTentativeDate('2025-01-01', today)).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    // Fri 2026-12-25: week began Mon 12/21, locked through Sun 2027-01-03.
    expect(firstTentativeDate('2026-12-25')).toBe('2027-01-04');
    expect(lastConfirmedDate('2026-12-25')).toBe('2027-01-03');
  });
});
