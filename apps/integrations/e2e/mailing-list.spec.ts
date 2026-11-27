// Mailing-list sign-ups: the landing page relays its forms here (server to
// server). A sign-up is a row in newsletter_subscribers; the volunteer list
// gets the newsletter too. An address on the suppression list stays
// suppressed, and gets the same answer as anyone else.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import { SECRETS } from './env';
import { expect, test } from './test';

const subscribe = (
  request: APIRequestContext,
  body: Record<string, unknown>,
  secret: string = SECRETS.mailingList
) =>
  request.post('/api/mailing-list/subscribe', {
    headers: { Authorization: `Bearer ${secret}` },
    data: body,
  });

test.describe.configure({ mode: 'parallel' });
test.describe('mailing-list sign-up', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a new address joins the newsletter list', async ({ request, db }, testInfo) => {
    const email = uniqueEmail(testInfo, 'newsletter');
    const response = await subscribe(request, {
      email: ` ${email.toUpperCase()} `,
      list: 'newsletter',
      source: 'website_form',
    });
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: 'subscribed' });
    const { data } = await db
      .from('newsletter_subscribers')
      .select('lists, source')
      .eq('email', email);
    expect(data).toEqual([{ lists: ['newsletter'], source: 'website_form' }]);
  });

  test('a volunteer sign-up adds the volunteer list and keeps the first source', async ({
    request,
    db,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'volunteer');
    await subscribe(request, { email, list: 'newsletter', source: 'promo_popup' });
    expect(
      (await subscribe(request, { email, list: 'volunteer', source: 'volunteer' })).status()
    ).toBe(200);
    const { data } = await db
      .from('newsletter_subscribers')
      .select('lists, source')
      .eq('email', email);
    expect(data).toEqual([{ lists: ['newsletter', 'volunteer'], source: 'promo_popup' }]);
  });

  test('an address that opted out stays suppressed', async ({ request, db }, testInfo) => {
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
    const { data } = await db.from('email_suppressions').select('id').eq('email', email);
    expect(data).toHaveLength(1);
  });

  test('refuses a wrong secret and bad input', async ({ request, db }, testInfo) => {
    const email = uniqueEmail(testInfo, 'refused');
    expect(
      (await subscribe(request, { email, list: 'newsletter', source: 'x' }, 'wrong')).status()
    ).toBe(401);
    expect((await subscribe(request, { email: 'nope', source: 'x' })).status()).toBe(400);
    expect((await subscribe(request, { email, list: 'everyone', source: 'x' })).status()).toBe(400);
    expect((await subscribe(request, { email, source: 'has spaces' })).status()).toBe(400);
    const { data } = await db.from('newsletter_subscribers').select('id').eq('email', email);
    expect(data).toEqual([]);
  });
});
