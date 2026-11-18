// /r/{CODE}: the code is resolved server-side against the mock integrations
// service (mock-server/integrations-fixtures.ts); the claim POST is stubbed.

import type { Page } from '@playwright/test';
import { allowConsole, DESKTOP_ONLY_TAG, stubJson } from '@pyre/e2e-utils';
import referral from '../src/lib/referral';
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

// Case folding happens in apps/integrations (the mock mirrors it). The page's
// job is to carry the canonical code it gets back, so the claim is filed
// under TESTCODE however the link was typed.
test('a lowercase link claims under the canonical code', async ({ page }) => {
  const requests = await stubJson(
    page,
    '**/api/referral-redemption',
    { ok: true },
    { method: 'POST' }
  );
  await page.goto(`/r/${REFERRAL.code.toLowerCase()}`);
  await expect(page).toHaveURL(new RegExp(`/r/${REFERRAL.code.toLowerCase()}$`));
  await expect(page.locator('h1').first()).toContainText(REFERRAL.displayName);

  await claim(page);
  await expect(page.locator('[data-referral-redeem-success]')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].postDataJSON()).toMatchObject({ code: REFERRAL.code });
});

async function claim(
  page: Page,
  fields: Partial<Record<'firstName' | 'lastName' | 'email', string>> = {}
) {
  const form = page.locator('[data-referral-redeem-form]');
  const values = { firstName: 'Sam', lastName: 'Tester', email: 'sam@example.com', ...fields };
  for (const [name, value] of Object.entries(values)) {
    await form.locator(`[name="${name}"]`).fill(value);
  }
  await form.locator('button[type="submit"]').click();
  return form;
}

test('claiming the discount', async ({ page }) => {
  const requests = await stubJson(
    page,
    '**/api/referral-redemption',
    { ok: true },
    { method: 'POST' }
  );
  await page.goto(`/r/${REFERRAL.code}`);

  await claim(page);

  await expect(page.locator('[data-referral-redeem-success]')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].postDataJSON()).toMatchObject({
    code: REFERRAL.code,
    email: 'sam@example.com',
  });
});

test('an invalid email is caught before sending', async ({ page }) => {
  const requests = await stubJson(page, '**/api/referral-redemption', { ok: true });
  await page.goto(`/r/${REFERRAL.code}`);

  await claim(page, { email: 'not-an-email' });
  await expect(page.locator('[data-referral-redeem-error]')).toHaveText(
    'Please enter a valid email.'
  );
  expect(requests).toHaveLength(0);
});

// Policy rejections arrive as 200 { result } and show friendly copy, leaving
// the form usable so a typo'd email can be fixed.
for (const result of Object.keys(
  referral.form.rejections
) as (keyof typeof referral.form.rejections)[]) {
  test(`a "${result}" rejection explains itself`, async ({ page }) => {
    await stubJson(page, '**/api/referral-redemption', { ok: false, result }, { method: 'POST' });
    await page.goto(`/r/${REFERRAL.code}`);

    const form = await claim(page);
    await expect(page.locator('[data-referral-redeem-error]')).toHaveText(
      referral.form.rejections[result]
    );
    await expect(form.locator('button[type="submit"]')).toBeEnabled();
    await expect(page.locator('[data-referral-redeem-success]')).toBeHidden();
  });
}

test.describe('when the claim fails outright', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 500/) });

  test('shows the generic error', async ({ page }) => {
    await stubJson(page, '**/api/referral-redemption', { ok: false }, { status: 500 });
    await page.goto(`/r/${REFERRAL.code}`);

    await claim(page);
    await expect(page.locator('[data-referral-redeem-error]')).toHaveText(
      referral.form.errorMessage
    );
  });
});

for (const code of ['NOSUCHCODE', 'no!', 'x']) {
  test(`an unknown or malformed code (${code}) bounces home`, { tag: DESKTOP_ONLY_TAG }, async ({
    request,
  }) => {
    const response = await request.get(`/r/${encodeURIComponent(code)}`, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe('/');
  });
}
