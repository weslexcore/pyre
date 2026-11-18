// Inbound webhooks and the cron tick: each refuses a delivery it can't
// verify, and acts on one it can. Server-to-server only, so desktop only.

import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import { SECRETS } from './env';
import { mailchimpDelivery, momenceDelivery, resendDelivery } from './signing';
import { expect, test } from './test';

test.describe.configure({ mode: 'parallel' });
test.describe('webhooks', { tag: DESKTOP_ONLY_TAG }, () => {
  test.describe('Momence', () => {
    test('accepts a signed delivery', async ({ request }) => {
      const delivery = momenceDelivery('session-created', { sessionId: 1 });
      const response = await request.post('/api/webhooks/momence', delivery);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ success: true });
    });

    test('refuses a wrong shared secret', async ({ request }) => {
      const delivery = momenceDelivery('session-created', { sessionId: 1 });
      const response = await request.post('/api/webhooks/momence', {
        ...delivery,
        headers: { ...delivery.headers, 'x-webhook-secret': 'wrong' },
      });
      expect(response.status()).toBe(401);
    });

    test('refuses a bad signature', async ({ request }) => {
      const delivery = momenceDelivery('session-created', { sessionId: 1 }, 'wrong-key');
      expect((await request.post('/api/webhooks/momence', delivery)).status()).toBe(401);
    });
  });

  test.describe('Mailchimp', () => {
    test('an unsubscribe suppresses the address', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'mailchimp');
      const delivery = mailchimpDelivery({ type: 'unsubscribe', 'data[email]': email });
      expect((await request.post(delivery.url, delivery)).status()).toBe(200);

      const { data } = await db
        .from('email_suppressions')
        .select('reason, source')
        .eq('email', email);
      expect(data).toEqual([{ reason: 'unsubscribe', source: 'mailchimp-webhook' }]);
    });

    test('refuses a bad signature', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'mailchimp-forged');
      const delivery = mailchimpDelivery(
        { type: 'unsubscribe', 'data[email]': email },
        'wrong-key'
      );
      expect((await request.post(delivery.url, delivery)).status()).toBe(401);
      const { data } = await db.from('email_suppressions').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    test('refuses a wrong URL secret', async ({ request }) => {
      const { headers, data } = mailchimpDelivery({
        type: 'unsubscribe',
        'data[email]': 'x@e2e.test',
      });
      const response = await request.post('/api/webhooks/mailchimp?secret=wrong', {
        headers,
        data,
      });
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Resend', () => {
    test('a hard bounce suppresses the address', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'bounce');
      const delivery = resendDelivery({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: { email_id: 'e2e', to: [email], bounce: { type: 'Permanent' } },
      });
      expect((await request.post('/api/webhooks/resend', delivery)).status()).toBe(200);

      const { data } = await db
        .from('email_suppressions')
        .select('reason, source')
        .eq('email', email);
      expect(data).toEqual([{ reason: 'bounce', source: 'resend-webhook' }]);
    });

    test('refuses a bad signature', async ({ request }) => {
      const delivery = resendDelivery(
        { type: 'email.bounced', data: { to: ['x@e2e.test'] } },
        `whsec_${Buffer.from('wrong-key').toString('base64')}`
      );
      expect((await request.post('/api/webhooks/resend', delivery)).status()).toBe(401);
    });
  });

  test.describe('cron tick', () => {
    test('refuses a caller without the secret', async ({ request }) => {
      expect((await request.get('/api/cron/tick?dryRun=1')).status()).toBe(401);
    });

    test('runs every job in a dry run', async ({ request }) => {
      const response = await request.get('/api/cron/tick?dryRun=1', {
        headers: { authorization: `Bearer ${SECRETS.cron}` },
        timeout: 60_000,
      });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        dryRun: boolean;
        jobs: Record<string, { error?: string; skipped?: string }>;
      };
      expect(body.dryRun).toBe(true);
      expect(Object.keys(body.jobs).length).toBeGreaterThan(0);
      // A job that throws reports { error }; none should, against the stack
      // and the mock upstreams.
      const failed = Object.entries(body.jobs).filter(([, result]) => result.error);
      expect(failed, 'jobs that failed').toEqual([]);
    });
  });
});
