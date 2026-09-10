import { describe, expect, it } from 'vitest';
import { COUNTED_PURCHASE_KINDS, classifyPurchase, isPurchaseItem } from './classify';

const INTRO_IDS = [630918];

const classify = (over: Partial<Parameters<typeof classifyPurchase>[0]>) =>
  classifyPurchase({
    itemType: 'membership',
    catalogMembershipId: 630916,
    membershipType: 'package-events',
    paymentSource: 'checkout-pages',
    introOfferIds: INTRO_IDS,
    ...over,
  });

describe('classifyPurchase', () => {
  it('recognizes the intro offer by catalog id whatever its type', () => {
    expect(classify({ catalogMembershipId: 630918 })).toBe('intro_offer');
    expect(classify({ catalogMembershipId: 630918, membershipType: 'subscription' })).toBe(
      'intro_offer'
    );
  });

  it('calls recurring bought-membership types a membership', () => {
    expect(classify({ catalogMembershipId: 756341, membershipType: 'subscription' })).toBe(
      'membership'
    );
    expect(classify({ membershipType: 'on-demand-subscription' })).toBe('membership');
    expect(classify({ membershipType: 'patron' })).toBe('membership');
    expect(classify({ itemType: 'monthly-subscription', membershipType: null })).toBe('membership');
  });

  it('calls package types a credit pack', () => {
    expect(classify({ membershipType: 'package-events' })).toBe('credit_pack');
    expect(classify({ membershipType: 'package-money' })).toBe('credit_pack');
    expect(classify({ itemType: 'event-credit', membershipType: null })).toBe('credit_pack');
    expect(classify({ itemType: 'money-credit', membershipType: null })).toBe('credit_pack');
  });

  it('separates renewals charged by Momence scheduled jobs', () => {
    for (const source of [
      'scheduled-job-renew-membership',
      'auto-renew-package-membership',
      'scheduled-job-retry-failed-membership-charge',
      'scheduled-job-pay-for-membership',
    ]) {
      expect(classify({ membershipType: 'subscription', paymentSource: source })).toBe('renewal');
    }
    expect(classify({ membershipType: 'subscription', paymentSource: null })).toBe('membership');
  });

  it('ignores line items that are not packs or memberships', () => {
    expect(classify({ itemType: 'session' })).toBe('other');
    expect(classify({ itemType: 'product' })).toBe('other');
    expect(classify({ itemType: 'gift-card' })).toBe('other');
  });

  it('cannot count a membership item whose bought record is unknown', () => {
    expect(classify({ membershipType: null })).toBe('other');
    expect(classify({ membershipType: 'something-new' })).toBe('other');
  });

  it('counts only first purchases toward campaigns', () => {
    expect([...COUNTED_PURCHASE_KINDS].sort()).toEqual([
      'credit_pack',
      'intro_offer',
      'membership',
    ]);
  });

  it('isPurchaseItem mirrors the item-type gate', () => {
    expect(isPurchaseItem('membership')).toBe(true);
    expect(isPurchaseItem('event-credit')).toBe(true);
    expect(isPurchaseItem('session')).toBe(false);
  });
});
