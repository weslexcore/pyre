import { DAY_MS, signJson, verifyJson } from '@/lib/http/signed-token';

// Signed "I'll take this shift" links for sub-request email. The recipient's
// staff id is bound into the payload so a link can only claim on behalf of
// the person it was sent to; expiry is a backstop — single-use is enforced by
// the sub_requests status transition, and the claim path re-validates the
// shift.

interface SubClaimPayload {
  /** sub_requests.id */
  id: string;
  /** The staff row this link was addressed to — the would-be claimer. */
  staffId: string;
  /** unix ms expiry */
  exp: number;
}

const SIGNING = {
  // process.env fallback: vars added after the cached build only exist at runtime.
  secret: () =>
    import.meta.env.SCHEDULE_LINK_SECRET ??
    process.env.SCHEDULE_LINK_SECRET ??
    import.meta.env.CRON_SECRET ??
    process.env.CRON_SECRET,
};

export function createSubClaimToken(
  subRequestId: string,
  staffId: string,
  expDays: number
): string | null {
  const payload: SubClaimPayload = {
    id: subRequestId,
    staffId,
    exp: Date.now() + expDays * DAY_MS,
  };
  return signJson(payload, SIGNING);
}

export type SubClaimTokenResult =
  | { status: 'valid'; subRequestId: string; staffId: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export function verifySubClaimToken(token: string): SubClaimTokenResult {
  const payload = verifyJson(token, SIGNING) as Partial<SubClaimPayload> | null;
  if (
    !payload ||
    typeof payload.id !== 'string' ||
    typeof payload.staffId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return { status: 'invalid' };
  }

  if (Date.now() > payload.exp) return { status: 'expired' };

  return { status: 'valid', subRequestId: payload.id, staffId: payload.staffId };
}
