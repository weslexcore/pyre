import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed confirm/deny links for partner verification email. The action is
// bound into the signed payload so a confirm token can never be replayed as a
// deny (or vice versa); expiry is enforced here, single-use is enforced by the
// partner_verifications status transition. Same HMAC shape as
// lib/email/unsubscribe-token.ts.

export type DecisionAction = 'confirm' | 'deny';

interface DecisionPayload {
  id: string;
  action: DecisionAction;
  /** unix ms expiry */
  exp: number;
}

function getSecret(): string | null {
  return import.meta.env.PARTNER_LINK_SECRET ?? import.meta.env.CRON_SECRET ?? null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createDecisionToken(
  requestId: string,
  action: DecisionAction,
  expDays: number
): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload: DecisionPayload = {
    id: requestId,
    action,
    exp: Date.now() + expDays * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export type DecisionTokenResult =
  | { status: 'valid'; requestId: string; action: DecisionAction }
  | { status: 'expired' }
  | { status: 'invalid' };

export function verifyDecisionToken(token: string): DecisionTokenResult {
  const secret = getSecret();
  if (!secret) return { status: 'invalid' };

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return { status: 'invalid' };

  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: 'invalid' };

  let payload: DecisionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid' };
  }

  if (
    typeof payload.id !== 'string' ||
    (payload.action !== 'confirm' && payload.action !== 'deny') ||
    typeof payload.exp !== 'number'
  ) {
    return { status: 'invalid' };
  }

  if (Date.now() > payload.exp) return { status: 'expired' };

  return { status: 'valid', requestId: payload.id, action: payload.action };
}
