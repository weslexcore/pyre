import { DAY_MS, signJson, verifyJson } from '@/lib/http/signed-token';

// Signed "yes, share my membership" link emailed to a Pyre member who asked us
// to vouch for them at a partner (member-verification.ts). Its own key prefix,
// so a partner confirm/deny token (decision-token.ts) never verifies here.
// Expiry is enforced here; single use by the row's status transition.

interface MemberTokenPayload {
  id: string;
  /** unix ms expiry */
  exp: number;
}

const SIGNING = {
  keyPrefix: 'member-perk:',
  // process.env fallback: vars added after the cached build only exist at runtime.
  secret: () =>
    import.meta.env.PARTNER_LINK_SECRET ??
    process.env.PARTNER_LINK_SECRET ??
    import.meta.env.CRON_SECRET ??
    process.env.CRON_SECRET,
};

export function createMemberToken(requestId: string, expDays: number): string | null {
  const payload: MemberTokenPayload = { id: requestId, exp: Date.now() + expDays * DAY_MS };
  return signJson(payload, SIGNING);
}

export type MemberTokenResult =
  | { status: 'valid'; requestId: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export function verifyMemberToken(token: string): MemberTokenResult {
  const payload = verifyJson(token, SIGNING) as Partial<MemberTokenPayload> | null;
  if (!payload || typeof payload.id !== 'string' || typeof payload.exp !== 'number') {
    return { status: 'invalid' };
  }
  if (Date.now() > payload.exp) return { status: 'expired' };
  return { status: 'valid', requestId: payload.id };
}
