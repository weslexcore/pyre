// Fixture data for the mock integrations service (apps/integrations), which
// the landing page calls server-side to resolve /r/{CODE} referral links. The
// shapes are shared contracts (@pyre/e2e-utils), which the integrations suite
// checks against the real endpoint.

export { REFERRAL, REFERRAL_UNKNOWN } from '@pyre/e2e-utils/server';
