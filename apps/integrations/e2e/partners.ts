// The reciprocal-discount partners the suite verifies customers against.
// auth.setup.ts writes these rows before any spec runs: the app caches the
// partner registry for 30s, so a partner added mid-run would read as unknown.

export const PARTNER = {
  slug: 'e2e-partner',
  name: 'E2E Climbing Gym',
  tagName: 'e2e-partner-verified',
  discountPercent: 20,
  /** Every confirm/deny email goes here. */
  contact: 'partner-desk@e2e.test',
  /** What it gives Pyre members (the /perks flow). */
  memberPerk: '10% off day passes',
} as const;

/** Switched off: it takes no new requests. */
export const PARTNER_OFF = {
  slug: 'e2e-partner-off',
  name: 'E2E Closed Gym',
  tagName: 'e2e-partner-off-verified',
  discountPercent: 15,
  contact: 'closed-desk@e2e.test',
  memberPerk: null,
} as const;

/** The referral tier the suite's referrers give (the shared contract's percent). */
export const REFERRAL_TIER = { percent: 25, tagName: 'referral-25' } as const;

/** Templates the workflow specs send; live under test, so they reach unique test addresses. */
export const LIVE_TEMPLATES = [
  'referral-redeemed',
  'referral-reward-earned',
  'partner-verification-request',
  'partner-verified',
  'partner-denied',
  'partner-member-confirm',
  'partner-member-verified',
  // Lost and found: the "is this yours?" email and the staff claim alert.
  'lost-found-found',
  'lost-found-claimed',
];
