import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed unsubscribe links. Every engine-sent marketing email carries
// /api/unsubscribe?token=<base64url(email)>.<hmac> so the link works without
// any per-recipient state and cannot be forged to unsubscribe someone else.

function getSecret(): string | null {
  return import.meta.env.UNSUBSCRIBE_SECRET ?? import.meta.env.CRON_SECRET ?? null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createUnsubscribeToken(email: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload = Buffer.from(email.toLowerCase()).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function buildUnsubscribeUrl(email: string): string | undefined {
  const token = createUnsubscribeToken(email);
  if (!token) return undefined;
  // PUBLIC_EMAIL_ASSET_BASE may carry a /email path — we only want the origin
  // of this app's deployment (same convention as emails/components/assets.ts).
  const origin = import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
  return `${origin}/api/unsubscribe?token=${token}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
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
