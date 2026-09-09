import { describe, expect, it } from 'vitest';
import { slugifyCampaign, slugToName } from './slug';

describe('slugToName', () => {
  it('round-trips every canonical slug', () => {
    for (const slug of ['credit-expiry', 'unused-credit', 'rest-fest-2026', 'bft-15', 'x']) {
      expect(slugifyCampaign(slugToName(slug))).toBe(slug);
    }
  });

  it('reads as a name', () => {
    expect(slugToName('credit-expiry')).toBe('Credit expiry');
    expect(slugToName('post-intro-offer')).toBe('Post intro offer');
    expect(slugToName('')).toBe('');
  });
});
