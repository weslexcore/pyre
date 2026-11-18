// What apps/integrations' GET /api/referral/lookup answers for a known code.
//
// The landing page calls that endpoint server-side to resolve /r/{CODE}. Its
// suite plays the integrations service with this fixture, and the
// integrations suite seeds the same referrer and checks the real endpoint
// returns exactly this. Both suites read the one definition, so the landing
// page's mock can't drift from the real API.

export interface ReferralLookup {
  code: string;
  displayName: string;
  discountPercent: number;
  referrerType: 'member' | 'partner';
}

export const REFERRAL: ReferralLookup = {
  code: 'TESTCODE',
  displayName: 'Jordan',
  discountPercent: 25,
  referrerType: 'member',
};

/** Its 404 body for a code that is unknown or disabled (the two look the same). */
export const REFERRAL_UNKNOWN = { error: 'unknown-code' } as const;
