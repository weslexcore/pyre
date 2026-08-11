import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import signupForm from '../../lib/signupForm';
import { verifyTurnstileToken } from '../../lib/turnstile';

export const prerender = false;

// Referral redemption intake. Same division of labor as the partner
// verification relay: this route owns the abuse checks (Turnstile, honeypots,
// timing, rate limits), then hands off server-to-server to the integrations
// service, which owns the Momence and email credentials. Browsers never call
// integrations directly, so no CORS.

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[A-Za-z0-9]{3,16}$/;

const IP_LIMIT = 20; // per hour
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

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

  // Honeypots + minimum fill time re-checked server-side; silent 200 so bots
  // learn nothing.
  const { honeypotFields, timestampField, minSubmissionTime } = signupForm.antiSpam;
  const honeypotTripped = [honeypotFields.website, honeypotFields.confirmEmail].some(
    (field) => typeof body[field] === 'string' && (body[field] as string).trim() !== ''
  );
  const startedAt = Number(body[timestampField]);
  const tooFast =
    !Number.isFinite(startedAt) || (Date.now() - startedAt) / 1000 < minSubmissionTime;
  if (honeypotTripped || tooFast) {
    return json(200, { ok: true, result: 'redeemed' });
  }

  if (!CODE_RE.test(code)) {
    return json(400, { ok: false, error: 'This referral link looks broken.' });
  }
  if (!firstName || firstName.length > MAX_NAME_LENGTH) {
    return json(400, { ok: false, error: 'Please enter your first name.' });
  }
  if (!lastName || lastName.length > MAX_NAME_LENGTH) {
    return json(400, { ok: false, error: 'Please enter your last name.' });
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json(400, { ok: false, error: 'Please enter a valid email.' });
  }

  if (!turnstileToken || !(await verifyTurnstileToken(turnstileToken))) {
    return json(400, { ok: false, error: 'Security check failed. Please try again.' });
  }

  const ip = clientAddress ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const ipKey = `referral:rl:ip:${ip}`;
  const emailKey = `referral:rl:email:${email}`;
  if (
    (await isRateLimited(ipKey, IP_LIMIT, 60 * 60)) ||
    (await isRateLimited(emailKey, EMAIL_LIMIT, 24 * 60 * 60))
  ) {
    return json(429, { ok: false, error: 'Too many requests — please try again later.' });
  }

  // A failure on our side shouldn't burn the caller's quota.
  const refundRateLimit = async () => {
    const redis = getRedis();
    if (!redis) return;
    try {
      await redis.decr(ipKey);
      await redis.decr(emailKey);
    } catch {
      // best-effort
    }
  };

  const integrationsUrl = import.meta.env.INTEGRATIONS_API_URL ?? process.env.INTEGRATIONS_API_URL;
  const apiSecret = import.meta.env.REFERRAL_API_SECRET ?? process.env.REFERRAL_API_SECRET;
  if (!integrationsUrl || !apiSecret) {
    console.error('[Referral] INTEGRATIONS_API_URL / REFERRAL_API_SECRET not configured');
    await refundRateLimit();
    return json(503, { ok: false, error: 'Redemption is temporarily unavailable.' });
  }

  try {
    const response = await fetch(`${integrationsUrl}/api/referral/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiSecret}`,
      },
      body: JSON.stringify({ code, firstName, lastName, email }),
    });
    const result = (await response.json().catch(() => ({}))) as { result?: string };

    if (response.ok) {
      // 'redeemed' or 'already-redeemed' — both end states the form explains.
      return json(200, { ok: true, result: result.result ?? 'redeemed' });
    }
    if (response.status === 409 || response.status === 400) {
      // Policy rejections ('existing-customer', 'self-referral', ...) pass
      // through as result codes so the form shows the right copy.
      return json(200, { ok: false, result: result.result ?? 'rejected' });
    }

    console.error(`[Referral] Integrations request failed: ${response.status}`);
    await refundRateLimit();
    return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
  } catch (error) {
    console.error('[Referral] Integrations request errored', error);
    await refundRateLimit();
    return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
  }
};
