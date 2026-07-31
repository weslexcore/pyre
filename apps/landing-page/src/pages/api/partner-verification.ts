import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import signupForm from '../../lib/signupForm';
import { verifyTurnstileToken } from '../../lib/turnstile';

export const prerender = false;

// Partner-discount verification intake. This route owns the abuse checks
// (Turnstile secret, honeypots, timing, rate limits) and then hands off
// server-to-server to the integrations service, which owns the Momence and
// email credentials. Browsers never call integrations directly, so no CORS.

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Formatting characters allowed; 10-15 digits with optional leading +.
const PHONE_RE = /^\+?[\d\s().-]{10,20}$/;

const IP_LIMIT = 5; // per hour
const EMAIL_LIMIT = 3; // per day

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** true = over the limit. Fails open when Redis is unconfigured. */
async function isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count > limit;
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid request' });
  }

  const partner = typeof body.partner === 'string' ? body.partner.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const partnerEmail =
    typeof body.partnerEmail === 'string' ? body.partnerEmail.trim().toLowerCase() : '';
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

  // Honeypots + minimum fill time re-checked server-side; the client-side
  // checks in the form are advisory only. Silent 200 so bots learn nothing.
  // The phone honeypot is excluded — this form has a real phone field, and
  // autofill filling a hidden phone_number input would swallow legit users.
  const { honeypotFields, timestampField, minSubmissionTime } = signupForm.antiSpam;
  const honeypotTripped = [honeypotFields.website, honeypotFields.confirmEmail].some(
    (field) => typeof body[field] === 'string' && (body[field] as string).trim() !== ''
  );
  const startedAt = Number(body[timestampField]);
  const tooFast =
    !Number.isFinite(startedAt) || (Date.now() - startedAt) / 1000 < minSubmissionTime;
  if (honeypotTripped || tooFast) {
    return json(200, { ok: true });
  }

  if (!partner || !firstName || firstName.length > MAX_NAME_LENGTH) {
    return json(400, { ok: false, error: 'Please enter your first name.' });
  }
  if (!lastName || lastName.length > MAX_NAME_LENGTH) {
    return json(400, { ok: false, error: 'Please enter your last name.' });
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json(400, { ok: false, error: 'Please enter a valid email.' });
  }
  if (!PHONE_RE.test(phone)) {
    return json(400, { ok: false, error: 'Please enter a valid phone number.' });
  }
  if (partnerEmail && (!EMAIL_RE.test(partnerEmail) || partnerEmail.length > MAX_EMAIL_LENGTH)) {
    return json(400, { ok: false, error: 'Please enter a valid membership email.' });
  }

  if (!turnstileToken || !(await verifyTurnstileToken(turnstileToken))) {
    return json(400, { ok: false, error: 'Security check failed. Please try again.' });
  }

  const ip = clientAddress ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (
    (await isRateLimited(`partner:rl:ip:${ip}`, IP_LIMIT, 60 * 60)) ||
    (await isRateLimited(`partner:rl:email:${email}`, EMAIL_LIMIT, 24 * 60 * 60))
  ) {
    return json(429, { ok: false, error: 'Too many requests — please try again later.' });
  }

  // process.env fallback: import.meta.env is inlined at build time, so values
  // added to Vercel after the cached build was compiled only exist at runtime.
  const integrationsUrl = import.meta.env.INTEGRATIONS_API_URL ?? process.env.INTEGRATIONS_API_URL;
  const apiSecret = import.meta.env.PARTNER_API_SECRET ?? process.env.PARTNER_API_SECRET;
  if (!integrationsUrl || !apiSecret) {
    console.error('[Partner] INTEGRATIONS_API_URL / PARTNER_API_SECRET not configured');
    return json(503, { ok: false, error: 'Verification is temporarily unavailable.' });
  }

  try {
    const response = await fetch(`${integrationsUrl}/api/partner/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiSecret}`,
      },
      body: JSON.stringify({
        partner,
        firstName,
        lastName,
        email,
        phone,
        partnerEmail: partnerEmail || undefined,
      }),
    });

    if (!response.ok) {
      console.error(`[Partner] Integrations request failed: ${response.status}`);
      return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error('[Partner] Integrations request errored', error);
    return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
  }
};
