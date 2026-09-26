import { emailLinkSecret, signString, verifyString } from '@/lib/http/signed-token';
import { appOrigin } from '@/lib/origins';

// Signed unsubscribe links. Every engine-sent marketing email carries
// /api/unsubscribe?token=<base64url(email)>.<hmac> so the link works without
// any per-recipient state and cannot be forged to unsubscribe someone else.

const SIGNING = { secret: emailLinkSecret };

export function createUnsubscribeToken(email: string): string | null {
  return signString(email.toLowerCase(), SIGNING);
}

export function buildUnsubscribeUrl(email: string): string | undefined {
  const token = createUnsubscribeToken(email);
  if (!token) return undefined;
  // PUBLIC_EMAIL_ASSET_BASE may carry a /email path — we only want the origin
  // of this app's deployment (same convention as emails/components/assets.ts).
  const origin = appOrigin();
  return `${origin}/api/unsubscribe?token=${token}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  return verifyString(token, SIGNING);
}
