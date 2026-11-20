// The mailing-list form on the home page. Mailchimp's JSONP endpoint is
// stubbed in the browser; everything up to that call is the real form,
// including the Turnstile check against /api/verify-turnstile (the widget is
// faked in ./test.ts, siteverify by the mock server).
//
// The form drops submissions from visitors it thinks are bots, partly by
// waiting for real input. No test here moves the mouse on purpose: each
// visitor uses only the input they would really have (a mouse click, the
// keyboard, a finger), so a check that wrongly demands a mouse fails here.

import type { Page } from '@playwright/test';
import { MOBILE_ONLY_TAG, stubMailchimpJsonp } from '@pyre/e2e-utils';
import { expect, test, waitForFormReady } from './test';

async function openForm(page: Page) {
  await page.goto('/');
  const form = page.locator('#signup [data-signup-form]').filter({ visible: true }).first();
  await form.scrollIntoViewIfNeeded();
  return form;
}

const success = (page: Page) =>
  page.locator('#signup [data-signup-success]').filter({ visible: true });
const error = (page: Page) => page.locator('#signup [data-signup-error]').filter({ visible: true });

/** Counts mouse input the page receives, so a test can prove it used none. */
async function countMouseInput(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __mouseInput?: number };
    w.__mouseInput = 0;
    for (const type of ['mousemove', 'mousedown', 'pointermove'] as const) {
      document.addEventListener(
        type,
        (event) => {
          if (!('pointerType' in event) || (event as PointerEvent).pointerType === 'mouse') {
            w.__mouseInput = (w.__mouseInput ?? 0) + 1;
          }
        },
        { capture: true, passive: true }
      );
    }
  });
  return () => page.evaluate(() => (window as Window & { __mouseInput?: number }).__mouseInput);
}

test('subscribes a valid email through Mailchimp', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page, { result: 'success' });
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('e2e@example.com');
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(success(page)).toHaveText(/\S/);
  await expect(page).toHaveURL(/[?&]subscribed=1/);
  expect(mailchimp).toHaveLength(1);
  expect(mailchimp[0].searchParams.get('EMAIL')).toBe('e2e@example.com');
});

test('a keyboard-only visitor can subscribe', async ({ page }) => {
  const mouseInput = await countMouseInput(page);
  const mailchimp = await stubMailchimpJsonp(page, { result: 'success' });
  const form = await openForm(page);

  // Arrive in the field the way Tab would, type, and submit with Enter.
  await form.locator('[data-signup-email]').focus();
  await page.keyboard.type('keyboard@example.com');
  await waitForFormReady(form);
  await page.keyboard.press('Enter');

  await expect(success(page)).toHaveText(/\S/);
  expect(mailchimp).toHaveLength(1);
  expect(mailchimp[0].searchParams.get('EMAIL')).toBe('keyboard@example.com');
  expect(await mouseInput()).toBe(0);
});

test('a touch-only visitor can subscribe', { tag: MOBILE_ONLY_TAG }, async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page, { result: 'success' });
  const form = await openForm(page);

  const email = form.locator('[data-signup-email]');
  await email.tap();
  // fill() inserts the text without key events, like a phone's autofill.
  await email.fill('touch@example.com');
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).tap();

  await expect(success(page)).toHaveText(/\S/);
  expect(mailchimp).toHaveLength(1);
  expect(mailchimp[0].searchParams.get('EMAIL')).toBe('touch@example.com');
});

test("shows Mailchimp's own error, without its markup, and a retry succeeds", async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page, [
    {
      result: 'error',
      msg: 'e2e@example.com is already subscribed. <a href="https://example.com">Update</a>',
    },
    { result: 'success' },
  ]);
  const form = await openForm(page);
  const email = form.locator('[data-signup-email]');
  const submit = form.getByRole('button', { name: /join/i });

  await email.fill('e2e@example.com');
  await waitForFormReady(form);
  await submit.click();

  await expect(error(page)).toHaveText('e2e@example.com is already subscribed. Update');
  await expect(page).not.toHaveURL(/subscribed=1/);
  await expect(submit).toBeEnabled();

  await email.fill('another@example.com');
  await submit.click();

  await expect(success(page)).toHaveText(/\S/);
  await expect(page).toHaveURL(/[?&]subscribed=1/);
  expect(mailchimp.map((url) => url.searchParams.get('EMAIL'))).toEqual([
    'e2e@example.com',
    'another@example.com',
  ]);
});

test('rejects an invalid email without calling Mailchimp', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page);
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill('not-an-email');
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(error(page)).toHaveText('Please enter a valid email.');
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
  await expect(success(page)).toHaveCount(0);
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

test('silently drops a bot: no input from any device', async ({ page }) => {
  const mailchimp = await stubMailchimpJsonp(page);
  const form = await openForm(page);

  // A script fills and submits the form without a key, touch or pointer event.
  await form.locator('[data-signup-email]').evaluate((input: HTMLInputElement) => {
    input.focus();
    input.value = 'script@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitForFormReady(form);
  await form.evaluate((el: HTMLFormElement) => el.requestSubmit());

  await page.waitForTimeout(1_000);
  expect(mailchimp).toHaveLength(0);
  await expect(success(page)).toHaveCount(0);
});
