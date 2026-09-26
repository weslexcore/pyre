import type { APIRoute } from 'astro';
import { json } from '@/lib/http/route';
import { isReferralAuthorized } from '@/lib/referral/api-auth';
import { redeemReferral } from '@/lib/referral/redemption';

export const prerender = false;

// Referral redemption intake. Called server-to-server by the landing page's
// /api/referral-redemption route (which owns Turnstile + rate limiting) —
// never by browsers, hence the shared-secret Bearer auth and no CORS.

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  if (!isReferralAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (
    !code ||
    !firstName ||
    firstName.length > MAX_NAME_LENGTH ||
    !lastName ||
    lastName.length > MAX_NAME_LENGTH
  ) {
    return json({ error: 'Invalid name' }, 400);
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json({ error: 'Invalid email' }, 400);
  }

  try {
    const result = await redeemReferral({ code, firstName, lastName, email });

    switch (result.outcome) {
      case 'redeemed':
        return json({ ok: true, result: 'redeemed' }, 200);
      case 'already-redeemed':
        // The friend already has (or had) a referral discount. Not an error —
        // the relay surfaces friendly copy keyed on this result.
        return json({ ok: true, result: 'already-redeemed' }, 200);
      case 'rejected':
        // 'unknown-code' is a caller bug or a dead link (400); the rest are
        // policy rejections the form explains (409 keeps them distinct).
        return json(
          { ok: false, result: result.reason },
          result.reason === 'unknown-code' ? 400 : 409
        );
      case 'unavailable':
        return json({ ok: false, error: result.reason }, 503);
    }
  } catch (error) {
    console.error('[Referral] Redemption failed', error);
    return json({ error: 'Request failed' }, 502);
  }
};
