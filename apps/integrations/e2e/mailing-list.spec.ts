// Mailing-list sign-ups: the landing page relays its forms here (server to
// server). A sign-up becomes a Resend contact in the newsletter segment; the
// volunteer list joins its own segment too. An address on the suppression list
// stays unsubscribed, and gets the same answer as anyone else.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import { SECRETS } from './env';
import { expect, test } from './test';
import { upstreamRequests } from './upstream';

const NEWSLETTER = 'e2e-newsletter-segment';
const VOLUNTEER = 'e2e-volunteer-segment';

const subscribe = (
  request: APIRequestContext,
  body: Record<string, unknown>,
  secret: string = SECRETS.mailingList
) =>
  request.post('/api/mailing-list/subscribe', {
    headers: { Authorization: `Bearer ${secret}` },
    data: body,
  });

async function createdContacts(email: string) {
  return (await upstreamRequests('POST', '/resend/contacts'))
    .map((r) => r.body as Record<string, unknown>)
    .filter((body) => body.email === email);
}

test.describe.configure({ mode: 'parallel' });
test.describe('mailing-list sign-up', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a new address becomes a contact in the newsletter segment', async ({
    request,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'newsletter');
    const response = await subscribe(request, {
      email: ` ${email.toUpperCase()} `,
      list: 'newsletter',
      source: 'website_form',
    });
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: 'subscribed' });
    expect(await createdContacts(email)).toEqual([{ email, segments: [{ id: NEWSLETTER }] }]);
  });

  test('a volunteer sign-up joins the volunteer segment as well', async ({ request }, testInfo) => {
    const email = uniqueEmail(testInfo, 'volunteer');
    expect(
      (await subscribe(request, { email, list: 'volunteer', source: 'volunteer' })).status()
    ).toBe(200);
    expect(await createdContacts(email)).toEqual([
      { email, segments: [{ id: NEWSLETTER }, { id: VOLUNTEER }] },
    ]);
  });

  test('an existing contact is added to the segment', async ({ request }, testInfo) => {
    const email = uniqueEmail(testInfo, 'existing');
    await subscribe(request, { email, list: 'newsletter', source: 'website_form' });
    const again = await subscribe(request, { email, list: 'newsletter', source: 'promo_popup' });
    expect(again.status()).toBe(200);
    expect(
      await upstreamRequests('POST', `/resend/contacts/${email}/segments/${NEWSLETTER}`)
    ).toHaveLength(1);
  });

  test('an address that opted out stays unsubscribed', async ({ request, db }, testInfo) => {
    const email = uniqueEmail(testInfo, 'opted-out');
    await db
      .from('email_suppressions')
      .insert({ email, reason: 'unsubscribe', source: 'e2e' })
      .throwOnError();

    const response = await subscribe(request, {
      email,
      list: 'newsletter',
      source: 'website_form',
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: 'subscribed' });
    expect(await createdContacts(email)).toEqual([
      { email, unsubscribed: true, segments: [{ id: NEWSLETTER }] },
    ]);
    const { data } = await db.from('email_suppressions').select('id').eq('email', email);
    expect(data).toHaveLength(1);
  });

  test('refuses a wrong secret and bad input', async ({ request }, testInfo) => {
    const email = uniqueEmail(testInfo, 'refused');
    expect(
      (await subscribe(request, { email, list: 'newsletter', source: 'x' }, 'wrong')).status()
    ).toBe(401);
    expect((await subscribe(request, { email: 'nope', source: 'x' })).status()).toBe(400);
    expect((await subscribe(request, { email, list: 'everyone', source: 'x' })).status()).toBe(400);
    expect((await subscribe(request, { email, source: 'has spaces' })).status()).toBe(400);
    expect(await createdContacts(email)).toEqual([]);
  });
});
