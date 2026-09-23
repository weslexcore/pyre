import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  campaigns: vi.fn(),
  shorts: vi.fn(),
  legacy: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  configured: vi.fn(),
}));
vi.mock('@pyre/webhook-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pyre/webhook-core')>()),
  getRedis: () => ({ get: mocks.get, set: mocks.set }),
  listCampaignsWithLinks: mocks.campaigns,
  getShortLinks: mocks.shorts,
  listShortLinks: mocks.legacy,
}));
vi.mock('@/lib/auth/admin', () => ({ requirePage: async () => ({ user: {} }) }));
vi.mock('@/lib/analytics/posthog-query', () => ({
  queryHogQL: mocks.query,
  isPostHogQueryConfigured: mocks.configured,
  getEventLastSeen: async () => new Map(),
}));

import { buildRollupQuery, GET } from '@/pages/api/admin/campaign-performance';

const request = () =>
  GET({
    cookies: {},
    url: new URL('https://example.com/api/admin/campaign-performance?campaign=friday'),
  } as APIContext);
const tags = ['instagram', 'social', 'bio', ''];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.campaigns.mockResolvedValue([
    {
      campaign: { id: 'c1', name: 'Friday', slug: 'friday', goals: [], createdAt: 1 },
      links: [
        {
          id: 'l1',
          source: 'instagram',
          medium: 'social',
          content: 'bio',
          term: '',
          placementKey: 'instagram-bio',
          label: '',
          variant: '',
          shortCode: 'abc',
          url: 'https://example.com?utm_campaign=friday&utm_source=instagram&utm_medium=social&utm_content=bio',
        },
      ],
    },
  ]);
  mocks.shorts.mockResolvedValue(new Map([['abc', { code: 'abc', clicks: 20 }]]));
  mocks.legacy.mockResolvedValue({ links: [] });
  mocks.query.mockResolvedValue([
    ['traffic', 'friday', '$pageview', 10, 7],
    ['conversion', 'friday', 'booking_completed', 5, 0],
    ['conversion', 'friday', 'Mailing List Signup', 3, 0],
    ['conversion', 'friday', 'purchase:membership', 2, 0],
    ['traffic_link', 'friday', '$pageview', 8, 0, ...tags],
    ['visitors_link', 'friday', '$pageview', 0, 6, ...tags],
    ['conversion_link', 'friday', 'booking_completed', 4, 0, ...tags],
    ['conversion_link', 'friday', 'Mailing List Signup', 2, 0, ...tags],
    ['conversion_link', 'friday', 'purchase:membership', 1, 0, ...tags],
  ]);
});
describe('campaign link report', () => {
  it('always separates UNION ALL and SELECT, including new branches', () => {
    const query = buildRollupQuery(30);
    expect(query).not.toContain('ALLSELECT');
    expect(query.match(/UNION ALL\s+SELECT/g)).toHaveLength(6);
    expect(query).toContain('GROUP BY campaign, person_id');
    expect(query).toContain('argMin(');
  });
  it('returns link metrics and unknown remainder without changing campaign totals', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaigns[0]).toMatchObject({
      bookings: 5,
      pageviews: 10,
      visitors: 7,
      memberships: 2,
      mailingListSignups: 3,
    });
    expect(body.campaigns[0].linkPerformance).toMatchObject([
      {
        id: 'l1',
        clicks: 20,
        pageviews: 8,
        visitors: 6,
        bookings: 4,
        memberships: 1,
        mailingListSignups: 2,
      },
      {
        id: 'unknown',
        clicks: 0,
        pageviews: 2,
        visitors: 1,
        bookings: 1,
        memberships: 1,
        mailingListSignups: 1,
      },
    ]);
  });
  it('uses a versioned cache with link breakdowns', async () => {
    await request();
    expect(mocks.set.mock.calls[0][0]).toBe('cache:campaign-perf:v5:30');
  });
  it('retains last good link metrics when PostHog fails', async () => {
    mocks.query.mockRejectedValue(new Error('offline'));
    mocks.get.mockImplementation(async (key: string) =>
      key.includes('last-good')
        ? {
            campaigns: [{ slug: 'friday', linkPerformance: [{ id: 'l1', memberships: 3 }] }],
            posthog: { configured: true },
            generatedAt: '2026-09-23',
          }
        : null
    );
    const body = await (await request()).json();
    expect(body.stale).toBe(true);
    expect(body.campaigns[0].linkPerformance[0].memberships).toBe(3);
  });
});
