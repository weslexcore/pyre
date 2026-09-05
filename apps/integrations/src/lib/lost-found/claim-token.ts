import { createHmac, timingSafeEqual } from 'node:crypto';

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

function getSecret(): string | null {
  return import.meta.env.UNSUBSCRIBE_SECRET ?? import.meta.env.CRON_SECRET ?? null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`lost-found:${payload}`).digest('base64url');
}

export function createClaimToken(noticeId: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload = Buffer.from(noticeId).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyClaimToken(token: string): string | null {
  const secret = getSecret();
  if (!secret) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** The app's own origin, matching how buildUnsubscribeUrl derives it. */
export function appOrigin(): string {
  return import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
}

export function buildClaimUrl(noticeId: string): string | undefined {
  const token = createClaimToken(noticeId);
  if (!token) return undefined;
  return `${appOrigin()}/api/lost-found/claim?token=${token}`;
}
