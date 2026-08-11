import type { APIRoute } from 'astro';
import { isReferralAuthorized } from '@/lib/referral/api-auth';
import { redeemReferral } from '@/lib/referral/redemption';

export const prerender = false;

// Referral redemption intake. Called server-to-server by the landing page's
// /api/referral-redemption route (which owns Turnstile + rate limiting) —
// never by browsers, hence the shared-secret Bearer auth and no CORS.

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!isReferralAuthorized(request)) {
    return json(401, { error: 'Unauthorized' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
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
    return json(400, { error: 'Invalid name' });
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json(400, { error: 'Invalid email' });
  }

  try {
    const result = await redeemReferral({ code, firstName, lastName, email });

    switch (result.outcome) {
      case 'redeemed':
        return json(200, { ok: true, result: 'redeemed' });
      case 'already-redeemed':
        // The friend already has (or had) a referral discount. Not an error —
        // the relay surfaces friendly copy keyed on this result.
        return json(200, { ok: true, result: 'already-redeemed' });
      case 'rejected':
        // 'unknown-code' is a caller bug or a dead link (400); the rest are
        // policy rejections the form explains (409 keeps them distinct).
        return json(result.reason === 'unknown-code' ? 400 : 409, {
          ok: false,
          result: result.reason,
        });
      case 'unavailable':
        return json(503, { ok: false, error: result.reason });
    }
  } catch (error) {
    console.error('[Referral] Redemption failed', error);
    return json(502, { error: 'Request failed' });
  }
};
