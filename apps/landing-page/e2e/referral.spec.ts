// /r/{CODE}: the code is resolved server-side against the mock integrations
// service (mock-server/integrations-fixtures.ts); the claim POST is stubbed.

import { stubJson } from '@pyre/e2e-utils';
import { REFERRAL } from './mock-server/integrations-fixtures';
import { expect, test } from './test';

test('a valid code shows who referred you and the discount', async ({ page }) => {
  await page.goto(`/r/${REFERRAL.code}`);
  await expect(page).toHaveTitle(
    `${REFERRAL.displayName} gave you ${REFERRAL.discountPercent}% off | Pyre Sauna`
  );
  await expect(page.locator('h1').first()).toContainText(REFERRAL.displayName);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('codes are case-insensitive', async ({ page }) => {
  await page.goto(`/r/${REFERRAL.code.toLowerCase()}`);
  await expect(page).toHaveURL(new RegExp(`/r/${REFERRAL.code.toLowerCase()}$`));
  await expect(page.locator('h1').first()).toContainText(REFERRAL.displayName);
});

test('claiming the discount', async ({ page }) => {
  const requests = await stubJson(
    page,
    '**/api/referral-redemption',
    { ok: true },
    { method: 'POST' }
  );
  await page.goto(`/r/${REFERRAL.code}`);

  const form = page.locator('[data-referral-redeem-form]');
  await form.locator('[name="firstName"]').fill('Sam');
  await form.locator('[name="lastName"]').fill('Tester');
  await form.locator('[name="email"]').fill('sam@example.com');
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('[data-referral-redeem-success]')).toBeVisible();
  expect(requests[0].postDataJSON()).toMatchObject({
    code: REFERRAL.code,
    email: 'sam@example.com',
  });
});

for (const code of ['NOSUCHCODE', 'no!', 'x']) {
  test(`an unknown or malformed code (${code}) bounces home`, async ({ request }) => {
    const response = await request.get(`/r/${encodeURIComponent(code)}`, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe('/');
  });
}
