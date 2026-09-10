// What kind of purchase a Momence sale line item is, for the campaign report.
//
// Momence files subscriptions and credit packs under the same `membership`
// item type, and a monthly renewal charge looks exactly like a first purchase
// in the sale itself. The distinctions live elsewhere: the bought
// membership's `type` (subscription vs package), the catalog id (the intro
// offer is a package like any other), and the transaction's `paymentSource`
// (renewals come from Momence's scheduled jobs, never from a checkout page).
// This module is pure so the rules can be unit-tested without Momence.

import type { BoughtMembership } from '@/lib/momence/host-api';
// Relative on purpose: scripts/backfill-purchases.mts loads this under tsx,
// which has no '@' alias at runtime.
import { RECURRING_MEMBERSHIP_TYPES } from '../momence/memberships';

export type PurchaseKind = 'intro_offer' | 'credit_pack' | 'membership' | 'renewal' | 'other';

/** Sale item types that mean "a customer bought a pack or a membership". */
export const PURCHASE_ITEM_TYPES: ReadonlySet<string> = new Set([
  'membership',
  'monthly-subscription',
  'event-credit',
  'money-credit',
]);

/** paymentSource values Momence uses when it charges a renewal on its own. */
export const RENEWAL_PAYMENT_SOURCES: ReadonlySet<string> = new Set([
  'scheduled-job-renew-membership',
  'auto-renew-package-membership',
  'scheduled-job-retry-failed-membership-charge',
  'scheduled-job-pay-for-membership',
]);

/** Kinds the campaign report counts as a conversion. Renewals are revenue,
 * not a campaign winning someone over. */
export const COUNTED_PURCHASE_KINDS: ReadonlySet<PurchaseKind> = new Set([
  'intro_offer',
  'credit_pack',
  'membership',
]);

const PACK_MEMBERSHIP_TYPES: ReadonlySet<string> = new Set(['package-events', 'package-money']);
const CREDIT_ITEM_TYPES: ReadonlySet<string> = new Set(['event-credit', 'money-credit']);

export function isPurchaseItem(itemType: string): boolean {
  return PURCHASE_ITEM_TYPES.has(itemType);
}

export interface ClassifyPurchaseInput {
  /** HostSaleItem.itemType */
  itemType: string;
  /** The catalog membership id (HostSaleItem.saleItemId for membership sales). */
  catalogMembershipId: number | null;
  /** BoughtMembership.type when the bought record could be read; null otherwise. */
  membershipType: string | null;
  /** HostPaymentTransaction.paymentSource; null for report rows that lack it. */
  paymentSource: string | null;
  introOfferIds: readonly number[];
}

export function classifyPurchase(input: ClassifyPurchaseInput): PurchaseKind {
  const { itemType, catalogMembershipId, membershipType, paymentSource, introOfferIds } = input;
  if (!PURCHASE_ITEM_TYPES.has(itemType)) return 'other';
  if (paymentSource && RENEWAL_PAYMENT_SOURCES.has(paymentSource)) return 'renewal';
  if (catalogMembershipId != null && introOfferIds.includes(catalogMembershipId)) {
    return 'intro_offer';
  }
  if (itemType === 'monthly-subscription') return 'membership';
  if (
    membershipType &&
    RECURRING_MEMBERSHIP_TYPES.has(membershipType as BoughtMembership['type'])
  ) {
    return 'membership';
  }
  if (membershipType && PACK_MEMBERSHIP_TYPES.has(membershipType)) return 'credit_pack';
  if (CREDIT_ITEM_TYPES.has(itemType)) return 'credit_pack';
  // A `membership` item whose bought record could not be read: not enough
  // to say pack or subscription, so it is captured but not counted.
  return 'other';
}
