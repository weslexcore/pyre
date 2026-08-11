// Shared-secret auth for the landing-page -> integrations referral relay.
// Its own secret (not PARTNER_API_SECRET) so the two programs can rotate keys
// independently.

export function isReferralAuthorized(request: Request): boolean {
  // process.env fallback: import.meta.env inlines at build time; vars added
  // after the cached build only exist at runtime.
  const secret = import.meta.env.REFERRAL_API_SECRET ?? process.env.REFERRAL_API_SECRET;
  if (!secret) {
    console.error('[Referral] REFERRAL_API_SECRET not configured — rejecting all requests');
    return false;
  }
  return request.headers.get('Authorization') === `Bearer ${secret}`;
}
