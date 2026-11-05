// The page → first-read map: a link to a page yields exactly the URLs its
// island asks for on mount, a trailing slash or an unknown page yields
// nothing, and only same-origin admin links are ever warmed.
import { addDays, todayEastern, weekStartOf } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import { isWarmableHref, jsonUrlsFor } from './pageData';

describe('jsonUrlsFor', () => {
  it('maps a static page to its island’s read', () => {
    expect(jsonUrlsFor('/admin/boards')).toEqual(['/api/admin/boards']);
    expect(jsonUrlsFor('/admin/sops')).toEqual([
      '/api/admin/sops',
      '/api/admin/sop-runs?view=active',
    ]);
  });

  it('ignores a trailing slash', () => {
    expect(jsonUrlsFor('/admin/boards/')).toEqual(['/api/admin/boards']);
  });

  it('builds the schedule board’s week from today, drafts included', () => {
    const start = weekStartOf(todayEastern());
    expect(jsonUrlsFor('/admin/schedule')).toEqual([
      `/api/admin/schedule-board?start=${start}&end=${addDays(start, 6)}&includeDrafts=1`,
      '/api/admin/shift-duties',
    ]);
  });

  it('follows a deep link’s date on the schedule', () => {
    const urls = jsonUrlsFor('/admin/schedule', new URLSearchParams('view=month&date=2026-11-18'));
    expect(urls[0]).toBe('/api/admin/schedule-board?start=2026-11-16&end=2026-11-22&includeDrafts=1');
  });

  it('frames the calendar month as whole weeks', () => {
    // A rule for a fixed month is not exposed, so check the shape: a Monday
    // to a Sunday spanning at least the month.
    const [board] = jsonUrlsFor('/admin/schedule/calendar');
    const match = board.match(/start=(\d{4}-\d{2}-\d{2})&end=(\d{4}-\d{2}-\d{2})$/);
    expect(match).not.toBeNull();
    const [, start, end] = match as RegExpMatchArray;
    expect(weekStartOf(start)).toBe(start);
    expect(addDays(weekStartOf(end), 6)).toBe(end);
    expect(start <= todayEastern() && todayEastern() <= end).toBe(true);
  });

  it('reads a board’s slug out of its path', () => {
    expect(jsonUrlsFor('/admin/boards/front desk')).toEqual([
      '/api/admin/board-cards?board=front%20desk',
    ]);
    // The fixed board pages are not slugs.
    expect(jsonUrlsFor('/admin/boards/all-goals')).toEqual(['/api/admin/goals']);
  });

  it('yields nothing for a page whose first read depends on saved state', () => {
    expect(jsonUrlsFor('/admin/guests/check-ins')).toEqual([]);
    expect(jsonUrlsFor('/admin')).toEqual([]);
    expect(jsonUrlsFor('/nowhere')).toEqual([]);
  });
});

describe('isWarmableHref', () => {
  const origin = 'https://admin.example.com';

  it('accepts same-origin admin links, relative or absolute', () => {
    expect(isWarmableHref('/admin/boards', origin)?.pathname).toBe('/admin/boards');
    expect(isWarmableHref(`${origin}/admin`, origin)?.pathname).toBe('/admin');
  });

  it('rejects other origins, non-admin paths, and the logout route', () => {
    expect(isWarmableHref('https://elsewhere.test/admin', origin)).toBeNull();
    expect(isWarmableHref('/api/auth/logout', origin)).toBeNull();
    expect(isWarmableHref('/forms/x', origin)).toBeNull();
    expect(isWarmableHref('not a url at all', origin)?.pathname ?? null).toBe(null);
  });
});
