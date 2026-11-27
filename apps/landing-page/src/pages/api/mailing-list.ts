import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { MAILING_LISTS, type MailingList } from '../../lib/mailing-list';
import signupForm from '../../lib/signupForm';
import { verifyTurnstileToken } from '../../lib/turnstile';

export const prerender = false;

// Mailing-list sign-up intake for every form on the site (the footer form, the
// promo popup, partner and link-in-bio pages, the volunteer page). Same
// division of labor as the referral and partner relays: this route owns the
// abuse checks (Turnstile, honeypots, timing, rate limits), then hands off
// server-to-server to the integrations service, which adds the address to the
// Resend newsletter segment. Browsers never call integrations directly.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_RE = /^[a-z0-9_-]{1,60}$/i;

const IP_LIMIT = 20; // per hour
const EMAIL_LIMIT = 5; // per day

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

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const list: MailingList = MAILING_LISTS.includes(body.list as MailingList)
    ? (body.list as MailingList)
    : 'newsletter';
  const source =
    typeof body.source === 'string' && SOURCE_RE.test(body.source) ? body.source : 'website_form';
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

  // Honeypots + minimum fill time re-checked server-side; a bot is told it
  // worked, so it learns nothing.
  const { honeypotFields, timestampField, minSubmissionTime } = signupForm.antiSpam;
  const honeypotTripped = Object.values(honeypotFields).some(
    (field) => typeof body[field] === 'string' && (body[field] as string).trim() !== ''
  );
  const startedAt = Number(body[timestampField]);
  const tooFast =
    !Number.isFinite(startedAt) || (Date.now() - startedAt) / 1000 < minSubmissionTime;
  if (honeypotTripped || tooFast) {
    return json(200, { ok: true, result: 'subscribed' });
  }

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json(400, { ok: false, error: signupForm.elements.errorMessage });
  }

  if (!turnstileToken || !(await verifyTurnstileToken(turnstileToken))) {
    return json(400, { ok: false, error: 'Security check failed. Please try again.' });
  }

  const ip = clientAddress ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const ipKey = `mailing-list:rl:ip:${ip}`;
  const emailKey = `mailing-list:rl:email:${email}`;
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
  const failed = async () => {
    await refundRateLimit();
    return json(502, { ok: false, error: 'Something went wrong. Please try again later.' });
  };

  const integrationsUrl = import.meta.env.INTEGRATIONS_API_URL ?? process.env.INTEGRATIONS_API_URL;
  const apiSecret = import.meta.env.MAILING_LIST_API_SECRET ?? process.env.MAILING_LIST_API_SECRET;
  if (!integrationsUrl || !apiSecret) {
    console.error('[Mailing list] INTEGRATIONS_API_URL / MAILING_LIST_API_SECRET not configured');
    return failed();
  }

  try {
    const response = await fetch(`${integrationsUrl}/api/mailing-list/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiSecret}`,
      },
      body: JSON.stringify({ email, list, source }),
    });
    if (response.ok) return json(200, { ok: true, result: 'subscribed' });
    console.error(`[Mailing list] Integrations request failed: ${response.status}`);
    return failed();
  } catch (error) {
    console.error('[Mailing list] Integrations request errored', error);
    return failed();
  }
};
