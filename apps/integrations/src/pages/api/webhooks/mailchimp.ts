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
// data[email]=...) and offers no signing — the URL secret is the auth.

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

  const form = await request.formData();
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
