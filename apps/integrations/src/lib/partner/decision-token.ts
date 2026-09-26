import { DAY_MS, signJson, verifyJson } from '@/lib/http/signed-token';

// Signed confirm/deny links for partner verification email. The action is
// bound into the signed payload so a confirm token can never be replayed as a
// deny (or vice versa); expiry is enforced here, single-use is enforced by the
// partner_verifications status transition.

export type DecisionAction = 'confirm' | 'deny';

interface DecisionPayload {
  id: string;
  action: DecisionAction;
  /** unix ms expiry */
  exp: number;
}

const SIGNING = {
  // process.env fallback: vars added after the cached build only exist at runtime.
  secret: () =>
    import.meta.env.PARTNER_LINK_SECRET ??
    process.env.PARTNER_LINK_SECRET ??
    import.meta.env.CRON_SECRET ??
    process.env.CRON_SECRET,
};

export function createDecisionToken(
  requestId: string,
  action: DecisionAction,
  expDays: number
): string | null {
  const payload: DecisionPayload = { id: requestId, action, exp: Date.now() + expDays * DAY_MS };
  return signJson(payload, SIGNING);
}

export type DecisionTokenResult =
  | { status: 'valid'; requestId: string; action: DecisionAction }
  | { status: 'expired' }
  | { status: 'invalid' };

export function verifyDecisionToken(token: string): DecisionTokenResult {
  const payload = verifyJson(token, SIGNING) as Partial<DecisionPayload> | null;
  if (
    !payload ||
    typeof payload.id !== 'string' ||
    (payload.action !== 'confirm' && payload.action !== 'deny') ||
    typeof payload.exp !== 'number'
  ) {
    return { status: 'invalid' };
  }

  if (Date.now() > payload.exp) return { status: 'expired' };

  return { status: 'valid', requestId: payload.id, action: payload.action };
}
