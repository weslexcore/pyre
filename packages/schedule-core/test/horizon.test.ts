// The two-week commitment horizon: dates inside it are set in stone, dates
// beyond it are tentative. The boundary is inclusive of today, so "two weeks"
// means today plus the next 13 days.

import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_HORIZON_DAYS,
  firstTentativeDate,
  isTentativeDate,
  lastConfirmedDate,
} from '../src/horizon';

describe('confirmed horizon', () => {
  const today = '2026-08-13';

  it('is set in stone for exactly two weeks including today', () => {
    expect(CONFIRMED_HORIZON_DAYS).toBe(14);
    expect(lastConfirmedDate(today)).toBe('2026-08-26');
    expect(firstTentativeDate(today)).toBe('2026-08-27');
  });

  it('classifies dates around the boundary', () => {
    expect(isTentativeDate(today, today)).toBe(false);
    expect(isTentativeDate('2026-08-26', today)).toBe(false);
    expect(isTentativeDate('2026-08-27', today)).toBe(true);
    expect(isTentativeDate('2027-01-01', today)).toBe(true);
  });

  it('treats past dates as history, not tentative', () => {
    expect(isTentativeDate('2026-08-12', today)).toBe(false);
    expect(isTentativeDate('2025-01-01', today)).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    expect(firstTentativeDate('2026-12-25')).toBe('2027-01-08');
    expect(lastConfirmedDate('2026-01-31')).toBe('2026-02-13');
  });
});
