// Fixture data for the mock integrations service (apps/integrations), which
// the landing page calls server-side: to resolve /r/{CODE} referral links, and
// to hand off referral claims and partner verification requests. The lookup
// shapes are shared contracts (@pyre/e2e-utils), which the integrations suite
// checks against the real endpoint.

export { REFERRAL, REFERRAL_UNKNOWN } from '@pyre/e2e-utils/server';

/**
 * How a test picks the mock's answer to a claim or verification request: by
 * the start of the submitted email (the label passed to uniqueEmail), so
 * parallel tests never need a global override.
 *
 *   fail-once-…           503 the first time that email is sent, then success
 *   <rejection result>-…  referral claims only: 409 { result }, as the real
 *                         service answers a policy rejection
 *   anything else         success
 */
export const UPSTREAM_EMAIL_LABEL = {
  failOnce: 'fail-once',
} as const;

/** Policy rejections the real redeem endpoint answers with 409 { ok: false, result }. */
export const REFERRAL_REJECTIONS = [
  'existing-customer',
  'self-referral',
  'referrer-disabled',
] as const;
