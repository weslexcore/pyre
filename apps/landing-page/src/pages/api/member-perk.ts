import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import signupForm from '../../lib/signupForm';
import { verifyTurnstileToken } from '../../lib/turnstile';

export const prerender = false;

// Member-perk intake (/perks): a Pyre member asks us to vouch for them at a
// partner. Like /api/partner-verification, this route owns the abuse checks
// (Turnstile, honeypots, timing, rate limits) and hands off server-to-server
// to integrations, which owns Momence and email. Integrations emails the
// member a confirm link; nothing reaches the partner until they click it.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const IP_LIMIT = 20; // per hour
const EMAIL_LIMIT = 5; // per day: a member may claim at several partners

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
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

  // Honeypots + minimum fill time, re-checked here; silent 200 so bots learn nothing.
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

  if (!partner) {
    return json(400, { ok: false, error: 'Please choose a partner.' });
  }
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json(400, { ok: false, error: 'Please enter a valid email.' });
  }

  if (!turnstileToken || !(await verifyTurnstileToken(turnstileToken))) {
    return json(400, { ok: false, error: 'Security check failed. Please try again.' });
  }

  const ip = clientAddress ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const ipKey = `member-perk:rl:ip:${ip}`;
  const emailKey = `member-perk:rl:email:${email}`;
  if (
    (await isRateLimited(ipKey, IP_LIMIT, 60 * 60)) ||
    (await isRateLimited(emailKey, EMAIL_LIMIT, 24 * 60 * 60))
  ) {
    return json(429, { ok: false, error: 'Too many requests. Please try again later.' });
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

  // process.env fallback: import.meta.env is inlined at build time.
  const integrationsUrl = import.meta.env.INTEGRATIONS_API_URL ?? process.env.INTEGRATIONS_API_URL;
  const apiSecret = import.meta.env.PARTNER_API_SECRET ?? process.env.PARTNER_API_SECRET;
  if (!integrationsUrl || !apiSecret) {
    console.error('[MemberPerk] INTEGRATIONS_API_URL / PARTNER_API_SECRET not configured');
    await refundRateLimit();
    return json(503, { ok: false, error: 'Verification is temporarily unavailable.' });
  }

  try {
    const response = await fetch(`${integrationsUrl}/api/partner/member-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiSecret}` },
      body: JSON.stringify({ partner, email }),
    });

    if (response.status === 403) {
      // The partner was switched off, or has no member perk set up yet.
      await refundRateLimit();
      return json(409, {
        ok: false,
        error:
          "That partner isn't taking requests right now. Please try another, or check back soon.",
      });
    }
    if (!response.ok) {
      console.error(`[MemberPerk] Integrations request failed: ${response.status}`);
      await refundRateLimit();
      return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error('[MemberPerk] Integrations request errored', error);
    await refundRateLimit();
    return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
  }
};
