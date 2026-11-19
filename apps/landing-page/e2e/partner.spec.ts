// Partner discount verification (/bft; /embody and /humble-haven share the
// component).
//
// The first tests stub /api/partner-verification in the browser to pin down
// the form's own behaviour. The rest go through the real route: its
// validation, the timing and honeypot checks, Turnstile (siteverify answered
// by the mock server) and the hand-off to the integrations service (also the
// mock server). Those check the mock's request log, because the route answers
// a discarded bot submission with the same success as a real one.

import type { Page } from '@playwright/test';
import {
  allowConsole,
  stubJson,
  stubTurnstile,
  TURNSTILE_SOLVED,
  uniqueEmail,
} from '@pyre/e2e-utils';
import { UPSTREAM_EMAIL_LABEL } from './mock-server/integrations-fixtures';
import { expect, test, upstreamRequests, waitForFormReady } from './test';

const UPSTREAM = '/integrations/api/partner/request';

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
  // Focusing the form starts the (fake) Turnstile check; submit once it has a token.
  await expect(form.locator('xpath=..').locator(TURNSTILE_SOLVED)).toHaveCount(1);
  return form;
}

const submitButton = (page: Page) =>
  page.locator('[data-partner-verify-form] button[type="submit"]');
const success = (page: Page) => page.locator('[data-partner-verify-success]');
const error = (page: Page) => page.locator('[data-partner-verify-error]');

test.describe('the form', () => {
  test('sends the request and confirms it', async ({ page }) => {
    const requests = await stubJson(
      page,
      '**/api/partner-verification',
      { ok: true },
      { method: 'POST' }
    );
    await page.goto('/bft');

    const form = await fill(page, {});
    await submitButton(page).click();

    await expect(success(page)).toBeVisible();
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

    await fill(page, { phone: '123' });
    await submitButton(page).click();

    await expect(error(page)).toHaveText('Please enter a valid phone number.');
    expect(requests).toHaveLength(0);
  });

  test.describe('when the server rejects the request', () => {
    test.use({ consoleAllowlist: allowConsole(/status of 400/) });

    test('shows its error, and the corrected request goes through', async ({ page }) => {
      const sent: unknown[] = [];
      await page.route('**/api/partner-verification', (route) => {
        sent.push(route.request().postDataJSON());
        return route.fulfill(
          sent.length === 1
            ? { status: 400, json: { ok: false, error: 'We could not verify that membership.' } }
            : { json: { ok: true } }
        );
      });
      await page.goto('/bft');

      await fill(page, {});
      await submitButton(page).click();
      await expect(error(page)).toHaveText('We could not verify that membership.');
      await expect(submitButton(page)).toBeEnabled();

      await page.locator('[data-partner-verify-form] [name="email"]').fill('riley@bft.example');
      await submitButton(page).click();

      await expect(success(page)).toBeVisible();
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({ email: 'riley@bft.example' });
    });
  });
});

test.describe('through the real route', () => {
  test('a verified request reaches the integrations service', async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo, 'partner');
    await page.goto('/bft');

    const form = await fill(page, { email: email.toUpperCase(), phone: ' (804) 555-0134 ' });
    await waitForFormReady(form);
    await submitButton(page).click();

    await expect(success(page)).toBeVisible();
    // The route trims and lower-cases what it forwards, and adds nothing else.
    const forwarded = await upstreamRequests(UPSTREAM, (body) => body.email === email);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].body).toEqual({
      partner: 'bft',
      firstName: VALID.firstName,
      lastName: VALID.lastName,
      email,
      phone: '(804) 555-0134',
    });
  });

  test('a bot that fills a honeypot is told it worked, and nothing is sent', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'partner-bot');
    await page.goto('/bft');

    const form = await fill(page, { email });
    await form.locator('input[name="website_url"]').evaluate((input: HTMLInputElement) => {
      input.value = 'https://spam.example';
    });
    await waitForFormReady(form);
    await submitButton(page).click();

    await expect(success(page)).toBeVisible();
    expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(0);
  });

  test.describe('when the security check fails', () => {
    test.use({ consoleAllowlist: allowConsole(/status of 400/) });

    test('says so and sends nothing', async ({ page }, testInfo) => {
      // A token the mock siteverify rejects.
      await stubTurnstile(page, 'forged-token');
      const email = uniqueEmail(testInfo, 'partner-forged');
      await page.goto('/bft');

      const form = await fill(page, { email });
      await waitForFormReady(form);
      await submitButton(page).click();

      await expect(error(page)).toHaveText('Security check failed. Please try again.');
      await expect(success(page)).toBeHidden();
      expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(0);
    });
  });

  test.describe('when the integrations service is down', () => {
    test.use({ consoleAllowlist: allowConsole(/status of 502/) });

    test('says so, and a retry goes through', async ({ page }, testInfo) => {
      // The mock fails this email's first request only.
      const email = uniqueEmail(testInfo, UPSTREAM_EMAIL_LABEL.failOnce);
      await page.goto('/bft');

      const form = await fill(page, { email });
      await waitForFormReady(form);
      await submitButton(page).click();

      await expect(error(page)).toHaveText('Something went wrong. Please try again later.');
      await expect(submitButton(page)).toBeEnabled();

      await submitButton(page).click();
      await expect(success(page)).toBeVisible();
      expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(2);
    });
  });
});
