import { describe, expect, it } from 'vitest';
import {
  buildClickersQuery,
  buildPurchaseClickersQuery,
  decideAttribution,
} from './booking-attribution';

describe('click queries', () => {
  it('matches a booking by session id with the checkout-href fallback', () => {
    const q = buildClickersQuery(142162708);
    expect(q).toContain("event = 'booking_link_clicked'");
    expect(q).toContain('properties.session_id');
    expect(q).toContain("'s/([0-9]+)'");
    expect(q).toContain("= '142162708'");
    expect(q).toContain('INTERVAL 30 MINUTE');
    expect(q).toContain('LIMIT 10');
  });

  it('matches a purchase by membership id across both click events', () => {
    const q = buildPurchaseClickersQuery(630916);
    expect(q).toContain("event IN ('purchase_link_clicked', 'booking_link_clicked')");
    expect(q).toContain('properties.membership_id');
    expect(q).toContain("'m/([0-9]+)'");
    expect(q).toContain("= '630916'");
    expect(q).toContain('INTERVAL 30 MINUTE');
  });
});

describe('decideAttribution', () => {
  const row = (personId: string, utmCampaign: string | null) => ({
    personId,
    utmCampaign,
    utmSource: null,
    utmMedium: null,
  });

  it('attributes person and campaign to a lone clicker', () => {
    expect(decideAttribution([row('p1', 'Instagram Bio Links')])).toEqual({
      attribution_method: 'session_click_inference',
      attributed_web_person_id: 'p1',
      attributed_utm_campaign: 'Instagram Bio Links',
    });
  });

  it('keeps the campaign when every clicker shares it, in any spelling', () => {
    expect(
      decideAttribution([row('p1', 'Instagram Bio Links'), row('p2', 'instagram-bio-links')])
    ).toEqual({
      attribution_method: 'session_click_shared_campaign',
      attributed_utm_campaign: 'Instagram Bio Links',
    });
  });

  it('gives up when clickers disagree or one has no campaign', () => {
    expect(decideAttribution([row('p1', 'a'), row('p2', 'b')])).toBeNull();
    expect(decideAttribution([row('p1', 'a'), row('p2', null)])).toBeNull();
    expect(decideAttribution([])).toBeNull();
  });
});

describe('link-level inference', () => {
  const first = {
    personId: 'p1',
    utmCampaign: 'friday',
    utmSource: 'instagram',
    utmMedium: 'social',
    utmContent: 'bio',
    utmTerm: 'new',
  };
  it('preserves the full link tuple for a lone clicker', () => {
    expect(decideAttribution([first])).toMatchObject({
      attributed_utm_source: 'instagram',
      attributed_utm_content: 'bio',
      attributed_utm_term: 'new',
    });
  });
  it('keeps a link only when all clickers agree on it', () => {
    expect(decideAttribution([first, { ...first, personId: 'p2' }])).toMatchObject({
      attributed_utm_content: 'bio',
    });
    expect(decideAttribution([first, { ...first, personId: 'p2', utmContent: 'story' }])).toEqual({
      attribution_method: 'session_click_shared_campaign',
      attributed_utm_campaign: 'friday',
    });
  });
  it('queries content and term with a consistent campaign origin', () => {
    const query = buildClickersQuery(123);
    expect(query).toContain('AS utm_content');
    expect(query).toContain('AS utm_term');
    expect(query).toContain('if(notEmpty(coalesce(toString(properties.utm_campaign)');
  });
});
