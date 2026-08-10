// Provider URL formats are external contracts (Google/Outlook parse them), so
// the exact date formats and required params get pinned here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCalendarLinks, VENUE_ADDRESS } from './links';

const args = {
  title: 'Signature Guided Class',
  startIso: '2026-06-20T14:00:00.000Z',
  endIso: '2026-06-20T16:00:00.000Z',
};

beforeEach(() => {
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('buildCalendarLinks', () => {
  it('builds a Google TEMPLATE URL with compact UTC dates', () => {
    const url = new URL(buildCalendarLinks(args).google);
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe(args.title);
    expect(url.searchParams.get('dates')).toBe('20260620T140000Z/20260620T160000Z');
    expect(url.searchParams.get('location')).toBe(VENUE_ADDRESS);
    expect(url.searchParams.get('details')).toContain('utm_campaign=confirmation');
  });

  it('builds an Outlook compose URL with second-precision ISO dates', () => {
    const url = new URL(buildCalendarLinks(args).outlook);
    expect(url.origin + url.pathname).toBe('https://outlook.live.com/calendar/0/action/compose');
    expect(url.searchParams.get('rru')).toBe('addevent');
    expect(url.searchParams.get('subject')).toBe(args.title);
    expect(url.searchParams.get('startdt')).toBe('2026-06-20T14:00:00Z');
    expect(url.searchParams.get('enddt')).toBe('2026-06-20T16:00:00Z');
    expect(url.searchParams.get('location')).toBe(VENUE_ADDRESS);
  });

  it('includes a hosted .ics link carrying a signed token when a secret is set', () => {
    const { ics } = buildCalendarLinks(args);
    expect(ics).toBeDefined();
    const url = new URL(ics as string);
    expect(url.pathname).toBe('/api/calendar/event.ics');
    expect(url.searchParams.get('d')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('omits the .ics link without a signing secret', () => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', '');
    vi.stubEnv('CRON_SECRET', '');
    const links = buildCalendarLinks(args);
    expect(links.ics).toBeUndefined();
    expect(links.google).toBeTruthy();
    expect(links.outlook).toBeTruthy();
  });
});
