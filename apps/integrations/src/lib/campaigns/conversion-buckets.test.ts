import { describe, expect, it } from 'vitest';
import { bucketColumn, conversionCounts } from './conversion-buckets';

describe('bucketColumn', () => {
  it('maps every counted bucket to its column', () => {
    expect(bucketColumn('Intro Offer Signup')).toBe('introOfferSignups');
    expect(bucketColumn('Mailing List Signup')).toBe('mailingListSignups');
    expect(bucketColumn('booking_completed')).toBe('bookings');
    expect(bucketColumn('booking_attribution_backfill')).toBe('bookings');
    expect(bucketColumn('purchase:intro_offer')).toBe('introPurchases');
    expect(bucketColumn('purchase:credit_pack')).toBe('creditPacks');
    expect(bucketColumn('purchase:membership')).toBe('memberships');
  });

  it('leaves renewals and uncounted purchase kinds out', () => {
    expect(bucketColumn('purchase:renewal')).toBeNull();
    expect(bucketColumn('purchase:other')).toBeNull();
    expect(bucketColumn('purchase:unknown')).toBeNull();
    expect(bucketColumn('purchase_completed')).toBeNull();
    expect(bucketColumn('$pageview')).toBeNull();
  });
});

describe('conversionCounts', () => {
  it('zero-fills missing columns', () => {
    expect(conversionCounts(undefined)).toEqual({
      introOfferSignups: 0,
      mailingListSignups: 0,
      bookings: 0,
      introPurchases: 0,
      creditPacks: 0,
      memberships: 0,
    });
    expect(conversionCounts(new Map([['creditPacks', 3]]))).toMatchObject({
      creditPacks: 3,
      memberships: 0,
    });
  });
});
