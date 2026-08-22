// What counts as a membership on /admin/business.
//
// Momence's `with-active-membership` filter is broader than the name suggests:
// it matches anyone holding any active bought-membership, and Momence files
// the intro package and credit packs under that same umbrella. Those are
// one-off purchases, not recurring monthly payments, so counting them inflates
// "active members" with people who bought a 5-pack once and may never come
// back — the number stops meaning "how many people pay us every month".
//
// The distinctions Momence does expose are BoughtMembership.type, the frozen
// flag, and the origin catalog id (which the post-intro-offer journey already
// uses to recognize the intro).

import type { BoughtMembership } from '@/lib/momence/host-api';

/**
 * Bought-membership types that bill on a repeating schedule.
 *
 * The package-* types are the ones deliberately left out: 'package-events' is
 * a fixed number of sessions and 'package-money' a prepaid balance — bought
 * once and burned down, never re-billed.
 */
export const RECURRING_MEMBERSHIP_TYPES: ReadonlySet<BoughtMembership['type']> = new Set<
  BoughtMembership['type']
>(['subscription', 'on-demand-subscription', 'patron']);

/**
 * Is this purchase a recurring monthly membership?
 *
 * Two exclusions beyond the type, both chosen to match "people paying us every
 * month" rather than "rows Momence calls active":
 *
 *   frozen       a freeze pauses billing, so the member is not currently
 *                paying even though the purchase is still active
 *   intro offers an intro sold as a discounted first subscription period is
 *                still an intro, so it is excluded by catalog id whatever its
 *                type (a no-op when the intro is a package instead)
 */
export function isRecurringMembership(
  pack: BoughtMembership,
  introOfferIds: readonly number[]
): boolean {
  if (!RECURRING_MEMBERSHIP_TYPES.has(pack.type)) return false;
  if (pack.isFrozen) return false;
  if (pack.membership !== null && introOfferIds.includes(pack.membership.id)) return false;
  return true;
}

/** True when any of a member's active purchases is a recurring membership. */
export function hasRecurringMembership(
  packs: readonly BoughtMembership[],
  introOfferIds: readonly number[]
): boolean {
  return packs.some((pack) => isRecurringMembership(pack, introOfferIds));
}
