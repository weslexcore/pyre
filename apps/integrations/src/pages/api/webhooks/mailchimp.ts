import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWebhookLogger } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { suppressEmail } from '@/lib/email/suppression';
import { instrumentWebhook, type TracedAPIRoute } from '@/lib/webhooks/instrument';

export const prerender = false;

const log = createWebhookLogger('Mailchimp');

// Mailchimp audience webhook — feeds unsubscribes/cleans collected inside
// Mailchimp into the authoritative suppression table so no other channel keeps
// emailing them. Configure in Mailchimp: Audience -> Settings -> Webhooks, URL
// https://<integrations>/api/webhooks/mailchimp?secret=<MAILCHIMP_WEBHOOK_SECRET>
// with the "unsubscribes" and "cleaned" events checked.
//
// Mailchimp posts application/x-www-form-urlencoded (type=unsubscribe,
// data[email]=...). Auth is two layers: the URL secret plus the
// X-Mailchimp-Signature header (t=<unix seconds>,v1=<hex>), where v1 is
// HMAC-SHA256 over `${t}.${rawBody}` keyed with MAILCHIMP_WEBHOOK_SIGNING_SECRET.

// Reject signatures older than this to block replayed requests.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function verifyMailchimpSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;

  // Header format: t=1718000000,v1=<hex>[,v1=<hex> during secret rotation]
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((sig) => {
    const candidate = Buffer.from(sig, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

// Mailchimp validates the webhook URL with a GET when it's saved.
export const GET: APIRoute = async () => new Response('ok', { status: 200 });

const handler: TracedAPIRoute = async ({ request, url }, tracer) => {
  const expectedSecret = import.meta.env.MAILCHIMP_WEBHOOK_SECRET;
  if (!expectedSecret) {
    log.error('MAILCHIMP_WEBHOOK_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (url.searchParams.get('secret') !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signingSecret = import.meta.env.MAILCHIMP_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    log.error('MAILCHIMP_WEBHOOK_SIGNING_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Signature covers the raw body bytes — read text first, parse form after.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-mailchimp-signature');
  if (!verifyMailchimpSignature(rawBody, signatureHeader, signingSecret)) {
    log.warn('Invalid webhook signature', { hasHeader: signatureHeader !== null });
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const form = new URLSearchParams(rawBody);
  const type = form.get('type')?.toString() ?? 'unknown';
  const email = form.get('data[email]')?.toString();

  log.info(`Received event: ${type}`, { email });

  if ((type === 'unsubscribe' || type === 'cleaned') && email) {
    // 'cleaned' = Mailchimp removed the address after hard bounces.
    const reason = type === 'cleaned' ? 'bounce' : 'unsubscribe';
    await tracer.span(`Suppress (${type}): ${email}`, () =>
      suppressEmail({ email, reason, source: 'mailchimp-webhook' })
    );
  } else {
    log.info(`Ignoring unhandled event: ${type}`);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST = instrumentWebhook('mailchimp', handler);
