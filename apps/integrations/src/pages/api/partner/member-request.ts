import type { APIRoute } from 'astro';
import { hasBearer } from '@/lib/http/bearer';
import { json } from '@/lib/http/route';
import { requestMemberVerification } from '@/lib/partner/member-verification';

export const prerender = false;

// Member-perk intake: a Pyre member asks us to vouch for them at a partner.
// Called server-to-server by the landing page's /api/member-perk route (which
// owns Turnstile and rate limiting), never by browsers: shared-secret Bearer
// auth, no CORS. Same secret as /api/partner/request.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  if (
    !hasBearer(
      request,
      import.meta.env.PARTNER_API_SECRET ?? process.env.PARTNER_API_SECRET,
      'Partner'
    )
  ) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const partner = typeof body.partner === 'string' ? body.partner.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!partner) return json({ error: 'Invalid partner' }, 400);
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json({ error: 'Invalid email' }, 400);
  }

  try {
    const result = await requestMemberVerification({ partnerSlug: partner, memberEmail: email });
    if (result.outcome === 'unavailable') {
      // Unknown slug is a caller bug (400); a partner switched off or without a
      // member perk is an admin choice (403); the rest is our config or an
      // outage (503, retryable).
      const status =
        result.reason === 'unknown-partner'
          ? 400
          : result.reason === 'partner-disabled' || result.reason === 'no-member-perk'
            ? 403
            : 503;
      return json({ error: result.reason }, status);
    }
    // 'duplicate' answers like 'created': a repeat can't probe request state.
    return json({ ok: true }, 200);
  } catch (error) {
    console.error('[Partner] Member verification request failed', error);
    return json({ error: 'Request failed' }, 502);
  }
};
