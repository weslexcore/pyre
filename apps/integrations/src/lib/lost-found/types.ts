// Lost & Found vocabulary: the fixed lists the form offers and the API
// validates against. Client-bundle-safe (no db/env imports) — the React
// islands import it directly, and the check constraints in the
// lost_and_found migration mirror these lists.
//
// There is deliberately no list of places an item was found. Incidents need
// one — where a fall happened is the point of the report — but a bottle in the
// bin only raises one question of place, and it is "where do I go to get it?".
// That is storage_location, free text, because "shelf B" and "staff room hook"
// are what staff actually say to each other. Where it was picked up told
// nobody anything and made the guest email longer.

export const LOST_FOUND_CATEGORIES = [
  'bottle',
  'clothing',
  'towel',
  'jewelry',
  'electronics',
  'bag',
  'eyewear',
  'keys',
  'wallet',
  'book',
  'toiletries',
  'other',
] as const;

export type LostFoundCategory = (typeof LOST_FOUND_CATEGORIES)[number];

export interface CategoryOption {
  value: LostFoundCategory;
  label: string;
}

// Order matters: these render as tap targets, and a water bottle is most of
// what ever goes in the bin.
export const CATEGORY_OPTIONS: CategoryOption[] = [
  // { value: 'bottle', label: 'Water bottle' },
  // { value: 'clothing', label: 'Clothing' },
  // { value: 'towel', label: 'Towel' },
  // { value: 'bag', label: 'Bag' },
  // { value: 'electronics', label: 'Electronics' },
  // { value: 'jewelry', label: 'Jewelry' },
  // { value: 'eyewear', label: 'Glasses / sunglasses' },
  // { value: 'keys', label: 'Keys' },
  // { value: 'wallet', label: 'Wallet / cards' },
  // { value: 'toiletries', label: 'Toiletries' },
  // { value: 'book', label: 'Book' },
  // { value: 'other', label: 'Something else' },
];

export const CATEGORY_LABELS: Record<LostFoundCategory, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label])
) as Record<LostFoundCategory, string>;

export const LOST_FOUND_STATUSES = [
  'unclaimed',
  'claim_pending',
  'claimed',
  'picked_up',
  'due_for_donation',
  'donated',
  'discarded',
] as const;

export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const STATUS_LABELS: Record<LostFoundStatus, string> = {
  unclaimed: 'Unclaimed',
  claim_pending: 'Claim pending',
  claimed: 'Claimed',
  picked_up: 'Picked up',
  due_for_donation: 'Due for donation',
  donated: 'Donated',
  discarded: 'Discarded',
};

/** Statuses where the item is still physically in the building. */
export const ON_HAND_STATUSES: LostFoundStatus[] = [
  'unclaimed',
  'claim_pending',
  'claimed',
  'due_for_donation',
];

/** Statuses where the item has left our hands — no more emails, no more claims. */
export const CLOSED_STATUSES: LostFoundStatus[] = ['picked_up', 'donated', 'discarded'];

/** Statuses a staff member may set by hand. Claims arrive from the claim link. */
export const STAFF_SETTABLE_STATUSES: LostFoundStatus[] = [
  'unclaimed',
  'claimed',
  'picked_up',
  'donated',
  'discarded',
];

/** How long an unclaimed item waits before it goes to Furbish Thrift. */
export const DONATION_WINDOW_DAYS = 30;

/** Where unclaimed items go. Named in the guest email and on the dashboard. */
export const DONATION_PARTNER = 'Furbish Thrift';

/**
 * How far back before `found_at` we assume the item could have been left.
 * A closing sweep turns up a bottle that may have sat there since the
 * afternoon, so the default window is generous and staff can widen it.
 */
export const DEFAULT_LOOKBACK_HOURS = 6;

/** Widest window we will ask Momence about — a guard, not a policy. */
export const MAX_WINDOW_HOURS = 72;

export function isLostFoundCategory(v: unknown): v is LostFoundCategory {
  return typeof v === 'string' && (LOST_FOUND_CATEGORIES as readonly string[]).includes(v);
}

export function isLostFoundStatus(v: unknown): v is LostFoundStatus {
  return typeof v === 'string' && (LOST_FOUND_STATUSES as readonly string[]).includes(v);
}

/**
 * Label for a stored category. Falls back to the stored value for anything the
 * label map doesn't cover — a category dropped from CATEGORY_OPTIONS but still
 * in LOST_FOUND_CATEGORIES used to return undefined here, and the first thing
 * downstream of it is a guest email being composed. A missing label should read
 * as "bottle", not throw halfway through a blast.
 */
export function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value as LostFoundCategory] ?? value;
}

export function statusLabel(value: string): string {
  return isLostFoundStatus(value) ? STATUS_LABELS[value] : value;
}

/** Whole days left before an item is due for donation; negative once overdue. */
export function daysUntilDonation(donateAfter: string, now: number = Date.now()): number {
  const due = Date.parse(donateAfter);
  if (Number.isNaN(due)) return 0;
  return Math.ceil((due - now) / 86_400_000);
}
