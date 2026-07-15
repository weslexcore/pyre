import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import { suppressEmail } from '@/lib/email/suppression';
import { instrumentWebhook, type TracedAPIRoute } from '@/lib/webhooks/instrument';

export const prerender = false;

const log = createWebhookLogger('Resend');

// Resend webhooks (svix-signed). Two jobs:
//  1. Suppression — permanent bounces, spam complaints, and contact
//     unsubscribes (broadcast footer / dashboard) feed the authoritative
//     email_suppressions table.
//  2. Engagement analytics — delivered/opened/clicked/bounced/complained become
//     PostHog events (distinctId = recipient email, matching booking_completed)
//     with the template/journey/campaign tags attached at send time.

// --- Svix signature verification (HMAC-SHA256, no svix dependency needed) ---
// Signed content is `${svix-id}.${svix-timestamp}.${rawBody}`; the secret is
// `whsec_<base64>`; the signature header holds space-separated `v1,<base64>`.

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function verifySvixSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);

  for (const part of signatureHeader.split(' ')) {
    const [version, signature] = part.split(',');
    if (version !== 'v1' || !signature) continue;
    const candidate = Buffer.from(signature);
    if (candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// --- Event payloads (the subset we consume) ---

interface ResendWebhookEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    subject?: string;
    email?: string;
    unsubscribed?: boolean;
    tags?: Record<string, string> | { name: string; value: string }[];
    bounce?: { type?: string; subType?: string };
    click?: { link?: string };
  };
}

function recipientsOf(event: ResendWebhookEvent): string[] {
  const to = event.data?.to;
  if (Array.isArray(to)) return to;
  if (typeof to === 'string') return [to];
  return [];
}

function tagsOf(event: ResendWebhookEvent): Record<string, string> {
  const tags = event.data?.tags;
  if (!tags) return {};
  if (Array.isArray(tags)) {
    return Object.fromEntries(tags.map((t) => [t.name, t.value]));
  }
  return tags;
}

// email.* types worth forwarding to PostHog as engagement events.
const ANALYTICS_EVENTS: Record<string, string> = {
  'email.delivered': 'email_delivered',
  'email.opened': 'email_opened',
  'email.clicked': 'email_clicked',
  'email.bounced': 'email_bounced',
  'email.complained': 'email_complained',
};

const handler: TracedAPIRoute = async ({ request }, tracer) => {
  const secret = import.meta.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    log.error('RESEND_WEBHOOK_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await request.text();

  const verified = await tracer.span(
    'Verify svix signature',
    async () => verifySvixSignature(rawBody, request.headers, secret),
    {}
  );
  if (!verified) {
    log.error('Invalid svix signature');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const event = JSON.parse(rawBody) as ResendWebhookEvent;
  log.info(`Received event: ${event.type}`);

  // 1. Suppression inputs.
  if (event.type === 'email.bounced') {
    const bounceType = event.data?.bounce?.type?.toLowerCase();
    if (bounceType !== 'transient') {
      for (const email of recipientsOf(event)) {
        await tracer.span(`Suppress (bounce): ${email}`, () =>
          suppressEmail({ email, reason: 'bounce', source: 'resend-webhook' })
        );
      }
    }
  } else if (event.type === 'email.complained') {
    for (const email of recipientsOf(event)) {
      await tracer.span(`Suppress (complaint): ${email}`, () =>
        suppressEmail({ email, reason: 'complaint', source: 'resend-webhook' })
      );
    }
  } else if (
    (event.type === 'contact.updated' || event.type === 'contact.created') &&
    event.data?.unsubscribed === true &&
    event.data.email
  ) {
    const email = event.data.email;
    await tracer.span(`Suppress (contact unsubscribed): ${email}`, () =>
      suppressEmail({ email, reason: 'unsubscribe', source: 'resend-contact' })
    );
  }

  // 2. Engagement analytics -> PostHog.
  const analyticsEvent = ANALYTICS_EVENTS[event.type];
  if (analyticsEvent) {
    const tags = tagsOf(event);
    for (const email of recipientsOf(event)) {
      await tracer.span(`PostHog ${analyticsEvent}: ${email}`, () =>
        captureEvent({
          distinctId: email.toLowerCase(),
          event: analyticsEvent,
          properties: {
            resend_email_id: event.data?.email_id,
            subject: event.data?.subject,
            template: tags.template,
            kind: tags.kind,
            journey: tags.journey,
            step: tags.step,
            campaign: tags.campaign,
            ...(event.data?.click?.link && { link: event.data.click.link }),
            ...(event.data?.bounce?.type && { bounce_type: event.data.bounce.type }),
          },
        })
      );
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST = instrumentWebhook('resend', handler);
