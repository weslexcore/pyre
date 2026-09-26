// Shared-secret auth for the landing-page -> integrations referral relay.
// Its own secret (not PARTNER_API_SECRET) so the two programs can rotate keys
// independently.

import { hasBearer } from '@/lib/http/bearer';

export function isReferralAuthorized(request: Request): boolean {
  // process.env fallback: import.meta.env inlines at build time; vars added
  // after the cached build only exist at runtime.
  return hasBearer(
    request,
    import.meta.env.REFERRAL_API_SECRET ?? process.env.REFERRAL_API_SECRET,
    'Referral'
  );
}
