// The newsletter send job: an approved issue goes out one copy per person on
// its list, through Resend's batch endpoint. Each copy has its own name,
// unsubscribe link and one-click headers; suppressed addresses are skipped;
// and a resumed send never mails anyone twice.

import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import { SECRETS } from './env';
import { expect, test } from './test';
import { type SentEmail, upstreamRequests } from './upstream';

type BatchEmail = SentEmail & { text: string; headers: Record<string, string> };

const content = {
  type: 'blocks',
  subject: 'December at Pyre',
  preview: 'What is on this month',
  background: 'clouds',
  blocks: [
    { type: 'heading', text: 'Hi {{firstName|there}}' },
    { type: 'paragraph', text: 'New evening sessions, [see them](https://pyresauna.com/events).' },
  ],
};

/** Copies of one issue the Resend mock got for `email` (refused attempts included). */
async function batchedTo(email: string, campaign: string): Promise<BatchEmail[]> {
  return (await upstreamRequests('POST', '/resend/emails/batch'))
    .flatMap((r) => r.body as BatchEmail[])
    .filter(
      (e) =>
        [e.to].flat().includes(email) &&
        e.tags?.some((t) => t.name === 'campaign' && t.value === campaign)
    );
}

test.describe.configure({ mode: 'serial' });
test.describe('newsletter send', { tag: DESKTOP_ONLY_TAG }, () => {
  test('sends each person their own copy, skips the suppressed, and never twice', async ({
    request,
    db,
  }, testInfo) => {
    const named = uniqueEmail(testInfo, 'named');
    const nameless = uniqueEmail(testInfo, 'nameless');
    const optedOut = uniqueEmail(testInfo, 'opted-out');
    const volunteerOnly = uniqueEmail(testInfo, 'other-list');
    await db
      .from('newsletter_subscribers')
      .insert([
        { email: named, first_name: 'Ana', lists: ['newsletter'], source: 'e2e' },
        { email: nameless, lists: ['newsletter'], source: 'e2e' },
        { email: optedOut, lists: ['newsletter'], source: 'e2e' },
        { email: volunteerOnly, lists: ['volunteer'], source: 'e2e' },
      ])
      .throwOnError();
    await db
      .from('email_suppressions')
      .insert({ email: optedOut, reason: 'unsubscribe', source: 'e2e' })
      .throwOnError();

    const campaign = `newsletter-e2e-${Date.now()}`;
    const { data: issue } = await db
      .from('newsletters')
      .insert({ campaign, content, status: 'sending', created_by: 'e2e' })
      .select('id')
      .single()
      .throwOnError();
    const id = (issue as { id: string }).id;

    const tick = () =>
      request.get('/api/cron/tick?job=newsletter-send', {
        headers: { authorization: `Bearer ${SECRETS.cron}` },
        timeout: 60_000,
      });
    const response = await tick();
    expect(response.status(), await response.text()).toBe(200);
    const { jobs } = (await response.json()) as {
      jobs: Record<string, { issues: { id: string; finished: boolean }[] }>;
    };
    expect(jobs['newsletter-send'].issues).toContainEqual(
      expect.objectContaining({ id, finished: true })
    );

    // One personal copy each.
    const [toNamed] = await batchedTo(named, campaign);
    expect(toNamed.subject).toBe('December at Pyre');
    expect(toNamed.html).toContain('Hi Ana');
    expect(toNamed.html).toContain('utm_campaign=' + campaign);
    expect(toNamed.html).not.toContain('{{{');
    expect(toNamed.text).toContain('/api/unsubscribe?token=');
    expect(toNamed.headers['List-Unsubscribe']).toMatch(
      /^<https?:\/\/.+\/api\/unsubscribe\?token=/
    );
    expect(toNamed.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(toNamed.tags).toEqual(
      expect.arrayContaining([
        { name: 'template', value: 'newsletter' },
        { name: 'campaign', value: campaign },
      ])
    );
    const [toNameless] = await batchedTo(nameless, campaign);
    expect(toNameless.html).toContain('Hi there');
    // Each link unsubscribes only its own recipient.
    expect(toNameless.headers['List-Unsubscribe']).not.toBe(toNamed.headers['List-Unsubscribe']);

    expect(await batchedTo(optedOut, campaign)).toEqual([]);
    expect(await batchedTo(volunteerOnly, campaign)).toEqual([]);

    // Logged with the Resend id the webhook attributes clicks by.
    const { data: sends } = await db
      .from('email_sends')
      .select('email, template, kind, campaign, status, resend_id')
      .in('email', [named, nameless, optedOut]);
    expect(sends).toHaveLength(2);
    for (const send of sends ?? []) {
      expect(send).toMatchObject({
        template: 'newsletter',
        kind: 'marketing',
        campaign,
        status: 'sent',
        resend_id: expect.stringMatching(/^e2e-email-/),
      });
    }

    const { data: done } = await db
      .from('newsletters')
      .select('status, sent_count, suppressed_count, finished_at')
      .eq('id', id)
      .single();
    expect(done).toMatchObject({ status: 'sent', finished_at: expect.any(String) });
    expect(done?.sent_count).toBeGreaterThanOrEqual(2);
    expect(done?.suppressed_count).toBeGreaterThanOrEqual(1);

    // Sent again from the top (a crash before the cursor was saved): nobody
    // gets a second copy.
    await db
      .from('newsletters')
      .update({ status: 'sending', cursor_email: null })
      .eq('id', id)
      .throwOnError();
    expect((await tick()).status()).toBe(200);
    expect(await batchedTo(named, campaign)).toHaveLength(1);
    expect(await batchedTo(nameless, campaign)).toHaveLength(1);
  });

  test('a draft or a scheduled issue is not sent yet', async ({ request, db }, testInfo) => {
    const email = uniqueEmail(testInfo, 'not-yet');
    await db.from('newsletter_subscribers').insert({ email, source: 'e2e' }).throwOnError();
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('newsletters')
      .insert([
        { campaign: 'newsletter-e2e-draft', content, status: 'draft', send_after: null },
        { campaign: 'newsletter-e2e-later', content, status: 'sending', send_after: later },
      ])
      .throwOnError();

    const response = await request.get('/api/cron/tick?job=newsletter-send', {
      headers: { authorization: `Bearer ${SECRETS.cron}` },
      timeout: 60_000,
    });
    expect(response.status()).toBe(200);
    expect(await batchedTo(email, 'newsletter-e2e-draft')).toEqual([]);
    expect(await batchedTo(email, 'newsletter-e2e-later')).toEqual([]);
  });
});
