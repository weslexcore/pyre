// The mailing-list form on the home page, through the real /api/mailing-list
// route: Turnstile verified server-side (the widget is faked in ./test.ts,
// siteverify by the mock server), then handed to the integrations service,
// which the mock server stands in for and logs.
//
// The form drops submissions from visitors it thinks are bots, partly by
// waiting for real input. No test here moves the mouse on purpose: each
// visitor uses only the input they would really have (a mouse click, the
// keyboard, a finger), so a check that wrongly demands a mouse fails here.

import type { Page } from '@playwright/test';
import { allowConsole, MOBILE_ONLY_TAG, stubJson, uniqueEmail } from '@pyre/e2e-utils';
import { UPSTREAM_EMAIL_LABEL } from './mock-server/integrations-fixtures';
import { expect, test, upstreamRequests, waitForFormReady } from './test';

const UPSTREAM = '/integrations/api/mailing-list/subscribe';

/** What reached the integrations service for this test's address. */
const forwarded = (email: string) => upstreamRequests(UPSTREAM, (body) => body.email === email);

async function openForm(page: Page) {
  await page.goto('/');
  const form = page.locator('#signup [data-signup-form]').filter({ visible: true }).first();
  await form.scrollIntoViewIfNeeded();
  return form;
}

const success = (page: Page) =>
  page.locator('#signup [data-signup-success]').filter({ visible: true });
const error = (page: Page) => page.locator('#signup [data-signup-error]').filter({ visible: true });

/**
 * Hides every mouse move from the page, so the form can't count one as human
 * input. Chromium fires a fake mousemove (and pointermove) after a scroll to
 * update hover state, even when nothing touched the mouse; on CI that alone
 * could get a keyboard-only or touch-only visitor past the bot check. The
 * listeners sit on window in the capture phase, ahead of the form's own on
 * document.
 *
 * Returns a count of mouse presses, which a browser never fakes, so a test can
 * prove it clicked nothing.
 */
async function withholdMouseMoves(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __mousePresses?: number };
    w.__mousePresses = 0;
    for (const type of ['mousemove', 'pointermove'] as const) {
      window.addEventListener(type, (event) => event.stopImmediatePropagation(), {
        capture: true,
      });
    }
    for (const type of ['mousedown', 'pointerdown'] as const) {
      window.addEventListener(
        type,
        (event) => {
          if (!('pointerType' in event) || (event as PointerEvent).pointerType === 'mouse') {
            w.__mousePresses = (w.__mousePresses ?? 0) + 1;
          }
        },
        { capture: true, passive: true }
      );
    }
  });
  return () => page.evaluate(() => (window as Window & { __mousePresses?: number }).__mousePresses);
}

test('subscribes a valid email through the integrations service', async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'signup');
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill(` ${address.toUpperCase()} `);
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(success(page)).toHaveText(/\S/);
  await expect(page).toHaveURL(/[?&]subscribed=1/);
  const sent = await forwarded(address);
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({ email: address, list: 'newsletter', source: 'website_form' });
});

test('a keyboard-only visitor can subscribe', async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'keyboard');
  const mousePresses = await withholdMouseMoves(page);
  const form = await openForm(page);

  // Arrive in the field the way Tab would, type, and submit with Enter.
  await form.locator('[data-signup-email]').focus();
  await page.keyboard.type(address);
  await waitForFormReady(form);
  await page.keyboard.press('Enter');

  await expect(success(page)).toHaveText(/\S/);
  expect(await forwarded(address)).toHaveLength(1);
  expect(await mousePresses()).toBe(0);
});

test('a touch-only visitor can subscribe', { tag: MOBILE_ONLY_TAG }, async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'touch');
  // A tap also fires compatibility mousedown events, so presses aren't
  // counted here; withholding moves is what keeps the bot check honest.
  await withholdMouseMoves(page);
  const form = await openForm(page);

  const email = form.locator('[data-signup-email]');
  await email.tap();
  // fill() inserts the text without key events, like a phone's autofill.
  await email.fill(address);
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).tap();

  await expect(success(page)).toHaveText(/\S/);
  expect(await forwarded(address)).toHaveLength(1);
});

test.describe('when the integrations service is down', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 502/) });

  test('says so, and a retry goes through', async ({ page }, testInfo) => {
    // The mock fails this address's first request only.
    const address = uniqueEmail(testInfo, UPSTREAM_EMAIL_LABEL.failOnce);
    const form = await openForm(page);
    const submit = form.getByRole('button', { name: /join/i });

    await form.locator('[data-signup-email]').fill(address);
    await waitForFormReady(form);
    await submit.click();

    await expect(error(page)).toHaveText('Something went wrong. Please try again later.');
    await expect(page).not.toHaveURL(/subscribed=1/);
    await expect(submit).toBeEnabled();

    // The spent Turnstile token is replaced before the retry.
    await submit.click();
    await expect(success(page)).toHaveText(/\S/);
    await expect(page).toHaveURL(/[?&]subscribed=1/);
    expect(await forwarded(address)).toHaveLength(2);
  });
});

test('rejects an invalid email without sending anything', async ({ page }, testInfo) => {
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill(`not-an-email-${testInfo.testId}`);
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(error(page)).toHaveText('Please enter a valid email.');
});

test('silently drops a bot: filled honeypot', async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'bot-honeypot');
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill(address);
  await form.locator('input[name="website_url"]').evaluate((input: HTMLInputElement) => {
    input.value = 'https://spam.example';
  });
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  // Give a real submission time to have happened, then check it didn't.
  await page.waitForTimeout(1_000);
  expect(await forwarded(address)).toHaveLength(0);
  await expect(success(page)).toHaveCount(0);
});

test('silently drops a bot: submitted too fast', async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'bot-fast');
  const form = await openForm(page);

  await form.locator('[data-signup-email]').fill(address);
  // Re-stamp the load time so the submit lands well inside the 3s window,
  // however slowly the dev server served the page.
  await form.locator('input[name="form_timestamp"]').evaluate((input: HTMLInputElement) => {
    input.value = String(Date.now());
  });
  await form.getByRole('button', { name: /join/i }).click();

  await page.waitForTimeout(1_000);
  expect(await forwarded(address)).toHaveLength(0);
});

test('silently drops a bot: no input from any device', async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'bot-script');
  const form = await openForm(page);

  // A script fills and submits the form without a key, touch or pointer event.
  await form.locator('[data-signup-email]').evaluate((input: HTMLInputElement, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, address);
  await waitForFormReady(form);
  await form.evaluate((el: HTMLFormElement) => el.requestSubmit());

  await page.waitForTimeout(1_000);
  expect(await forwarded(address)).toHaveLength(0);
  await expect(success(page)).toHaveCount(0);
});

test.describe('the route on its own', () => {
  test('tells a too-fast bot it worked, and sends nothing', async ({ request }, testInfo) => {
    const address = uniqueEmail(testInfo, 'route-fast');
    const response = await request.post('/api/mailing-list', {
      data: { email: address, form_timestamp: String(Date.now()), turnstileToken: 'x' },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: 'subscribed' });
    expect(await forwarded(address)).toHaveLength(0);
  });

  test('refuses a submission without a valid security check', async ({ request }, testInfo) => {
    const address = uniqueEmail(testInfo, 'route-no-token');
    const response = await request.post('/api/mailing-list', {
      data: {
        email: address,
        form_timestamp: String(Date.now() - 10_000),
        turnstileToken: 'forged',
      },
    });
    expect(response.status()).toBe(400);
    expect(await forwarded(address)).toHaveLength(0);
  });
});

test('the volunteer page signs up to the volunteer list', async ({ page }, testInfo) => {
  const address = uniqueEmail(testInfo, 'volunteer');
  await stubJson(page, '**/api/volunteer-events', {
    events: [],
    cached: false,
    timestamp: new Date().toISOString(),
  });
  await page.goto('/volunteer');
  const form = page.locator('[data-volunteer-empty] [data-signup-form]');
  await form.scrollIntoViewIfNeeded();

  await form.locator('[data-signup-email]').fill(address);
  await waitForFormReady(form);
  await form.getByRole('button', { name: /join/i }).click();

  await expect(page.locator('[data-volunteer-empty] [data-signup-success]')).toHaveText(/\S/);
  const sent = await forwarded(address);
  expect(sent.map((r) => r.body)).toEqual([
    { email: address, list: 'volunteer', source: 'volunteer_empty_state' },
  ]);
});
