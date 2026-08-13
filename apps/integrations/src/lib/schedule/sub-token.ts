import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed "I'll take this shift" links for sub-request email. The recipient's
// staff id is bound into the payload so a link can only claim on behalf of
// the person it was sent to; expiry is a backstop — single-use is enforced by
// the sub_requests status transition, and the claim path re-validates the
// shift. Same HMAC shape as lib/partner/decision-token.ts.

interface SubClaimPayload {
  /** sub_requests.id */
  id: string;
  /** The staff row this link was addressed to — the would-be claimer. */
  staffId: string;
  /** unix ms expiry */
  exp: number;
}

function getSecret(): string | null {
  // process.env fallback: vars added after the cached build only exist at runtime.
  return (
    import.meta.env.SCHEDULE_LINK_SECRET ??
    process.env.SCHEDULE_LINK_SECRET ??
    import.meta.env.CRON_SECRET ??
    process.env.CRON_SECRET ??
    null
  );
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSubClaimToken(
  subRequestId: string,
  staffId: string,
  expDays: number
): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload: SubClaimPayload = {
    id: subRequestId,
    staffId,
    exp: Date.now() + expDays * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export type SubClaimTokenResult =
  | { status: 'valid'; subRequestId: string; staffId: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export function verifySubClaimToken(token: string): SubClaimTokenResult {
  const secret = getSecret();
  if (!secret) return { status: 'invalid' };

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return { status: 'invalid' };

  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: 'invalid' };

  let payload: SubClaimPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid' };
  }

  if (
    typeof payload.id !== 'string' ||
    typeof payload.staffId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return { status: 'invalid' };
  }

  if (Date.now() > payload.exp) return { status: 'expired' };

  return { status: 'valid', subRequestId: payload.id, staffId: payload.staffId };
}
