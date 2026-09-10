// Static-markup render of the performance panel's goal block: no report has
// arrived yet at this point, so the numbers are the live short-link clicks and
// zeros, read against the pace the campaign's dates imply.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LinkRow, UtmCampaign } from '@/lib/campaigns/types';
import { CampaignStats } from './CampaignStats';

const CAMPAIGN: UtmCampaign = {
  id: 'c-1',
  name: 'Winter intro offer',
  slug: 'winter-intro-offer',
  type: 'sale',
  status: 'active',
  destinationKind: 'home',
  destinationValue: '',
  destinationUrl: 'https://pyresauna.com/',
  startsAt: '2026-09-01',
  endsAt: '2026-09-30',
  notes: '',
  goals: [
    { metric: 'clicks', target: 10 },
    { metric: 'memberships', target: 4 },
  ],
  createdAt: Date.parse('2026-09-01T12:00:00Z'),
  createdBy: 'marina@pyresauna.com',
  updatedAt: Date.parse('2026-09-01T12:00:00Z'),
};

const LINK: LinkRow = {
  id: 'l-1',
  campaignId: 'c-1',
  label: '',
  url: 'https://pyresauna.com/?utm_campaign=winter-intro-offer',
  destination: 'https://pyresauna.com/',
  source: 'instagram',
  medium: 'social',
  campaign: 'winter-intro-offer',
  term: '',
  content: 'bio',
  placementKey: 'instagram-bio',
  variant: '',
  shortCode: 'abc123',
  qrStyle: '',
  createdAt: Date.parse('2026-09-01T12:00:00Z'),
  createdBy: 'marina@pyresauna.com',
  shortUrl: 'https://pyresauna.com/s/abc123',
  clicks: 6,
};

describe('CampaignStats goals', () => {
  it('reads each goal against its target', () => {
    const html = renderToStaticMarkup(<CampaignStats campaign={CAMPAIGN} links={[LINK]} />);
    expect(html).toContain('Goals');
    expect(html).toContain('Link clicks');
    expect(html).toContain('Memberships started');
    // Live clicks stand in until the report lands.
    expect(html).toContain('/ 10');
    expect(html).toContain('/ 4');
  });

  it('nudges a campaign with no goals to set some', () => {
    const html = renderToStaticMarkup(
      <CampaignStats campaign={{ ...CAMPAIGN, goals: [] }} links={[LINK]} />
    );
    expect(html).toContain('No goals set');
    expect(html).not.toContain('expected by now');
  });
});
