// Wrong inferred attribution is stamped onto immutable PostHog events, so the
// decision rules (especially the strict multi-clicker disqualifiers) get pinned
// down here.

import { describe, expect, it } from 'vitest';
import { type ClickerRow, decideAttribution } from './booking-attribution';

const clicker = (overrides: Partial<ClickerRow> = {}): ClickerRow => ({
  personId: 'person-1',
  utmCampaign: null,
  utmSource: null,
  utmMedium: null,
  ...overrides,
});

describe('decideAttribution', () => {
  it('returns null when nobody clicked', () => {
    expect(decideAttribution([])).toBeNull();
  });

  it('attributes a single clicker with full utm attribution', () => {
    expect(
      decideAttribution([
        clicker({
          personId: 'abc',
          utmCampaign: 'Instagram Bio Links',
          utmSource: 'instagram',
          utmMedium: 'social',
        }),
      ])
    ).toEqual({
      attribution_method: 'session_click_inference',
      attributed_web_person_id: 'abc',
      attributed_utm_campaign: 'Instagram Bio Links',
      attributed_utm_source: 'instagram',
      attributed_utm_medium: 'social',
    });
  });

  it('attributes a single clicker without utm values (person link only)', () => {
    expect(decideAttribution([clicker({ personId: 'abc' })])).toEqual({
      attribution_method: 'session_click_inference',
      attributed_web_person_id: 'abc',
    });
  });

  it('attributes campaign only when multiple clickers share one campaign', () => {
    const result = decideAttribution([
      clicker({ personId: 'a', utmCampaign: 'summer-launch' }),
      clicker({ personId: 'b', utmCampaign: 'summer-launch' }),
    ]);
    expect(result).toEqual({
      attribution_method: 'session_click_shared_campaign',
      attributed_utm_campaign: 'summer-launch',
    });
    expect(result?.attributed_web_person_id).toBeUndefined();
  });

  it('rolls raw campaign variants up via slugification for the shared match', () => {
    expect(
      decideAttribution([
        clicker({ personId: 'a', utmCampaign: 'Instagram Bio Links' }),
        clicker({ personId: 'b', utmCampaign: 'instagram-bio-links' }),
      ])
    ).toMatchObject({ attribution_method: 'session_click_shared_campaign' });
  });

  it('returns null when any of several clickers lacks a campaign', () => {
    expect(
      decideAttribution([
        clicker({ personId: 'a', utmCampaign: 'summer-launch' }),
        clicker({ personId: 'b', utmCampaign: null }),
      ])
    ).toBeNull();
  });

  it('returns null when several clickers carry different campaigns', () => {
    expect(
      decideAttribution([
        clicker({ personId: 'a', utmCampaign: 'summer-launch' }),
        clicker({ personId: 'b', utmCampaign: 'friday-social' }),
      ])
    ).toBeNull();
  });
});
