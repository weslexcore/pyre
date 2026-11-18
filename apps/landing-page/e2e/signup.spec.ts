// The mailing-list form on the home page. Mailchimp's JSONP endpoint is
// stubbed in the browser; everything up to that call is the real form.

import type { Page } from '@playwright/test';
import { stubMailchimpJsonp } from '@pyre/e2e-utils';
import { expect, test, waitForFormReady } from './test';

async function openForm(page: Page) {
  await page.goto('/');
  const form = page.locator('#signup [data-signup-form]').filter({ visible: true }).first();
  await form.scrollIntoViewIfNeeded();
  // The form only accepts a visitor who has moved the mouse and interacted.
  await page.mouse.move(10, 10);
  await page.mouse.move(200, 200);
  return form;
}

test('subscribes a valid email through Mailchimp', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page, { result: 'success' });
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('e2e@example.com');
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(page.locator('#signup [data-signup-success]').filter({ visible: true })).toHaveText(
    /\S/
  );
  await expect(page).toHaveURL(/[?&]subscribed=1/);
  expect(mailchimp).toHaveLength(1);
  expect(mailchimp[0].searchParams.get('EMAIL')).toBe('e2e@example.com');
});

test("shows Mailchimp's own error, without its markup", async ({ page }) => {
  await stubMailchimpJsonp(page, {
    result: 'error',
    msg: 'e2e@example.com is already subscribed. <a href="https://example.com">Update</a>',
  });
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('e2e@example.com');
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(page.locator('#signup [data-signup-error]').filter({ visible: true })).toHaveText(
    'e2e@example.com is already subscribed. Update'
  );
  await expect(page).not.toHaveURL(/subscribed=1/);
  await expect(form.getByRole('button', { name: /join/i })).toBeEnabled();
});

test('rejects an invalid email without calling Mailchimp', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page);
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('not-an-email');
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(page.locator('#signup [data-signup-error]').filter({ visible: true })).toHaveText(
    'Please enter a valid email.'
  );
  expect(mailchimp).toHaveLength(0);
});

test('silently drops a bot: filled honeypot', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page);
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('bot@example.com');
  await form.locator('input[name="website_url"]').evaluate((input: HTMLInputElement) => {
    input.value = 'https://spam.example';
  });
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  // Give a real submission time to have happened, then check it didn't.
  await page.waitForTimeout(1_000);
  expect(mailchimp).toHaveLength(0);
  await expect(page.locator('#signup [data-signup-success]').filter({ visible: true })).toHaveCount(
    0
  );
});

test('silently drops a bot: submitted too fast', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page);
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('fast@example.com');
  // Re-stamp the load time so the submit lands well inside the 3s window,
  // however slowly the dev server served the page.
  await form.locator('input[name="form_timestamp"]').evaluate((input: HTMLInputElement) => {
    input.value = String(Date.now());
  });
  await form.getByRole('button', { name: /join/i }).click();

  await page.waitForTimeout(1_000);
  expect(mailchimp).toHaveLength(0);
});
