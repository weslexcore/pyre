// Fixture data for the mock integrations service (apps/integrations), which
// the landing page calls server-side to resolve /r/{CODE} referral links.

export const REFERRAL = {
  code: 'TESTCODE',
  displayName: 'Jordan',
  discountPercent: 25,
  referrerType: 'member' as const,
};
