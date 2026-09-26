import type { APIRoute } from 'astro';
import { hasBearer } from '@/lib/http/bearer';
import { json } from '@/lib/http/route';
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
  // process.env fallback: import.meta.env inlines at build time; vars added
  // after the cached build only exist at runtime.
  return hasBearer(
    request,
    import.meta.env.PARTNER_API_SECRET ?? process.env.PARTNER_API_SECRET,
    'Partner'
  );
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
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
    return json({ error: 'Invalid name' }, 400);
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json({ error: 'Invalid email' }, 400);
  }
  if (!phone) {
    return json({ error: 'Invalid phone' }, 400);
  }
  if (partnerEmail && (!EMAIL_RE.test(partnerEmail) || partnerEmail.length > MAX_EMAIL_LENGTH)) {
    return json({ error: 'Invalid partner email' }, 400);
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
      // Unknown slug is a caller bug (400). A disabled partner is a deliberate
      // admin choice rather than a fault, so it's a 403 the relay can surface
      // as "not accepting requests". Everything else is our config gap or a
      // storage outage — 503, retryable.
      const status =
        result.reason === 'unknown-partner'
          ? 400
          : result.reason === 'partner-disabled'
            ? 403
            : 503;
      return json({ error: result.reason }, status);
    }

    // 'duplicate' is deliberately indistinguishable from 'created' — repeat
    // submissions can't probe request state or re-email the partner.
    return json({ ok: true }, 200);
  } catch (error) {
    console.error('[Partner] Verification request failed', error);
    return json({ error: 'Request failed' }, 502);
  }
};
