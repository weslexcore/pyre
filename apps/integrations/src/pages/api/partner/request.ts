import type { APIRoute } from 'astro';
import { createVerificationRequest } from '@/lib/partner/verification';

export const prerender = false;

// Partner-verification intake. Called server-to-server by the landing page's
// /api/partner-verification route (which owns Turnstile + rate limiting) —
// never by browsers, hence the shared-secret Bearer auth and no CORS.

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Keep a leading + and digits; drop formatting. Null if not phone-shaped. */
function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d{10,15}$/.test(cleaned)) return null;
  return cleaned;
}

function isAuthorized(request: Request): boolean {
  const secret = import.meta.env.PARTNER_API_SECRET;
  if (!secret) {
    console.error('[Partner] PARTNER_API_SECRET not configured — rejecting all requests');
    return false;
  }
  return request.headers.get('Authorization') === `Bearer ${secret}`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return json(401, { error: 'Unauthorized' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const partner = typeof body.partner === 'string' ? body.partner.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? normalizePhone(body.phone.trim()) : null;
  const partnerEmail =
    typeof body.partnerEmail === 'string' ? body.partnerEmail.trim().toLowerCase() : '';

  if (
    !partner ||
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
  if (!phone) {
    return json(400, { error: 'Invalid phone' });
  }
  if (partnerEmail && (!EMAIL_RE.test(partnerEmail) || partnerEmail.length > MAX_EMAIL_LENGTH)) {
    return json(400, { error: 'Invalid partner email' });
  }

  try {
    const result = await createVerificationRequest({
      partnerSlug: partner,
      customerFirstName: firstName,
      customerLastName: lastName,
      customerEmail: email,
      customerPhone: phone,
      partnerMemberEmail: partnerEmail || undefined,
    });

    if (result.outcome === 'unavailable') {
      // Unknown slug is a caller bug; the rest are our config gaps.
      const status = result.reason === 'unknown-partner' ? 400 : 503;
      return json(status, { error: result.reason });
    }

    // 'duplicate' is deliberately indistinguishable from 'created' — repeat
    // submissions can't probe request state or re-email the partner.
    return json(200, { ok: true });
  } catch (error) {
    console.error('[Partner] Verification request failed', error);
    return json(502, { error: 'Request failed' });
  }
};
