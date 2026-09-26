import { emailLinkSecret, signString, verifyString } from '@/lib/http/signed-token';
import { appOrigin } from '@/lib/origins';

// Signed claim links. Every "is this yours?" email carries
// /api/lost-found/claim?token=<base64url(noticeId)>.<hmac>, so the link works
// without any per-recipient state and cannot be forged to claim an item as
// someone else.
//
// The token addresses a *notice* (one person, one item), not the item itself.
// That is the whole trick: a click tells us who claimed it without asking the
// guest to type anything, and a link forwarded to a friend still resolves to
// the person we actually emailed — which is what staff check at pickup.
//
// Same construction as lib/email/unsubscribe-token.ts, deliberately: one HMAC
// pattern to reason about, and the same secret already in the environment.

const SIGNING = { secret: emailLinkSecret, messagePrefix: 'lost-found:' };

export function createClaimToken(noticeId: string): string | null {
  return signString(noticeId, SIGNING);
}

export function verifyClaimToken(token: string): string | null {
  return verifyString(token, SIGNING);
}

export function buildClaimUrl(noticeId: string): string | undefined {
  const token = createClaimToken(noticeId);
  if (!token) return undefined;
  return `${appOrigin()}/api/lost-found/claim?token=${token}`;
}
