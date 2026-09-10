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
