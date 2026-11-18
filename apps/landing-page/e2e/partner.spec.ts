// Partner discount verification (/bft; /embody and /humble-haven share the
// component). The POST to /api/partner-verification is stubbed: its server
// side needs Turnstile and the integrations service, and is covered in
// apps/integrations.

import type { Page } from '@playwright/test';
import { allowConsole, stubJson } from '@pyre/e2e-utils';
import { expect, test } from './test';

const VALID = {
  firstName: 'Riley',
  lastName: 'Tester',
  email: 'riley@example.com',
  phone: '(804) 555-0134',
};

async function fill(page: Page, fields: Partial<typeof VALID>) {
  const form = page.locator('[data-partner-verify-form]');
  for (const [name, value] of Object.entries({ ...VALID, ...fields })) {
    await form.locator(`[name="${name}"]`).fill(value);
  }
  return form;
}

test('sends the request and confirms it', async ({ page }) => {
  const requests = await stubJson(
    page,
    '**/api/partner-verification',
    { ok: true },
    { method: 'POST' }
  );
  await page.goto('/bft');

  const form = await fill(page, {});
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('[data-partner-verify-success]')).toBeVisible();
  await expect(form).toBeHidden();

  expect(requests).toHaveLength(1);
  expect(requests[0].postDataJSON()).toMatchObject({
    partner: 'bft',
    firstName: VALID.firstName,
    lastName: VALID.lastName,
    email: VALID.email,
    phone: VALID.phone,
  });
});

test('validates the phone number before sending', async ({ page }) => {
  const requests = await stubJson(page, '**/api/partner-verification', { ok: true });
  await page.goto('/bft');

  const form = await fill(page, { phone: '123' });
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('[data-partner-verify-error]')).toHaveText(
    'Please enter a valid phone number.'
  );
  expect(requests).toHaveLength(0);
});

test.describe('when the server rejects the request', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 400/) });

  test('shows its error and lets the visitor retry', async ({ page }) => {
    await stubJson(
      page,
      '**/api/partner-verification',
      { ok: false, error: 'We could not verify that membership.' },
      { status: 400 }
    );
    await page.goto('/bft');

    const form = await fill(page, {});
    const submit = form.locator('button[type="submit"]');
    await submit.click();

    await expect(page.locator('[data-partner-verify-error]')).toHaveText(
      'We could not verify that membership.'
    );
    await expect(submit).toBeEnabled();
  });
});
