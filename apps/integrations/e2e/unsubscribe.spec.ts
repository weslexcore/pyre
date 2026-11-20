// The unsubscribe link in marketing email: a genuine token suppresses the
// address, a forged one does nothing.

import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import { signString } from '../src/lib/http/signed-token';
import { SECRETS } from './env';
import { expect, test } from './test';
import { expectUnsubscribeMirrored, upstreamRequests } from './upstream';

const tokenFor = (email: string) =>
  signString(email.toLowerCase(), { secret: () => SECRETS.unsubscribe }) as string;

test('a genuine link unsubscribes the address', async ({ page, db }, testInfo) => {
  const email = uniqueEmail(testInfo, 'unsubscribe');
  const response = await page.goto(`/api/unsubscribe?token=${tokenFor(email)}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText(`You've been unsubscribed (${email})`)).toBeVisible();

  const { data } = await db.from('email_suppressions').select('reason, source').eq('email', email);
  expect(data).toEqual([{ reason: 'unsubscribe', source: 'unsubscribe-link' }]);
  await expectUnsubscribeMirrored(email);
});

test('a forged link is refused', { tag: DESKTOP_ONLY_TAG }, async ({ request, db }, testInfo) => {
  const email = uniqueEmail(testInfo, 'forged');
  const forged = signString(email, { secret: () => 'not-the-secret' }) as string;

  expect((await request.get(`/api/unsubscribe?token=${forged}`)).status()).toBe(400);
  expect((await request.post(`/api/unsubscribe?token=${forged}`)).status()).toBe(400);
  const { data } = await db.from('email_suppressions').select('id').eq('email', email);
  expect(data).toEqual([]);
  expect(await upstreamRequests('PATCH', `/resend/contacts/${email}`)).toEqual([]);
});
