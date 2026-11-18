// Sign webhook deliveries the way each sender does, with the secrets the app
// runs with under test (env.ts). The specs build requests from these rather
// than copying the app's verifiers, so a verifier that drifts from the
// sender's scheme fails here.

import { createHmac } from 'node:crypto';
import { SECRETS } from './env';

/** Momence: `{ payload: "<json>" }`, a shared-secret header, and a hex HMAC of the payload string. */
export function momenceDelivery(
  event: string,
  payload: unknown,
  signingSecret: string = SECRETS.momenceSigning
) {
  const payloadString = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  return {
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': SECRETS.momenceWebhook,
      'x-webhook-signature': createHmac('sha256', signingSecret)
        .update(payloadString)
        .digest('hex'),
      'x-webhook-reqeuest-id': `e2e-${Date.now()}`,
    },
    data: JSON.stringify({ payload: payloadString }),
  };
}

/** Mailchimp: a form-encoded body and `t=<ts>,v1=<hex HMAC of "ts.body">`. */
export function mailchimpDelivery(
  fields: Record<string, string>,
  signingSecret: string = SECRETS.mailchimpSigning
) {
  const body = new URLSearchParams(fields).toString();
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', signingSecret).update(`${t}.${body}`).digest('hex');
  return {
    url: `/api/webhooks/mailchimp?secret=${encodeURIComponent(SECRETS.mailchimpWebhook)}`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-mailchimp-signature': `t=${t},v1=${v1}`,
    },
    data: body,
  };
}

/** Resend (Svix): `v1,<base64 HMAC of "id.ts.body">` keyed by the decoded whsec_ secret. */
export function resendDelivery(event: unknown, secret: string = SECRETS.resendWebhook) {
  const body = JSON.stringify(event);
  const id = `msg_e2e_${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return {
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': `v1,${signature}`,
    },
    data: body,
  };
}
