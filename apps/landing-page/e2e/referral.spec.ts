// /r/{CODE}: the code is resolved server-side against the mock integrations
// service (mock-server/integrations-fixtures.ts).
//
// The claim form's own behaviour is tested with /api/referral-redemption
// stubbed in the browser. The tests under "through the real route" run the
// route itself: validation, the timing and honeypot checks, Turnstile
// (siteverify answered by the mock server) and the hand-off to the
// integrations service. They check the mock's request log, because the route
// answers a discarded bot submission with the same success as a real claim.

import type { Page } from '@playwright/test';
import {
  allowConsole,
  DESKTOP_ONLY_TAG,
  stubJson,
  TURNSTILE_SOLVED,
  uniqueEmail,
} from '@pyre/e2e-utils';
import referral from '../src/lib/referral';
import { REFERRAL, UPSTREAM_EMAIL_LABEL } from './mock-server/integrations-fixtures';
import { expect, test, upstreamRequests, waitForFormReady } from './test';

const UPSTREAM = '/integrations/api/referral/redeem';

type ClaimFields = Partial<Record<'firstName' | 'lastName' | 'email', string>>;

async function fillClaim(page: Page, fields: ClaimFields = {}) {
  const form = page.locator('[data-referral-redeem-form]');
  const values = { firstName: 'Sam', lastName: 'Tester', email: 'sam@example.com', ...fields };
  for (const [name, value] of Object.entries(values)) {
    await form.locator(`[name="${name}"]`).fill(value);
  }
  // Focusing the form starts the (fake) Turnstile check; submit once it has a token.
  await expect(form.locator('xpath=..').locator(TURNSTILE_SOLVED)).toHaveCount(1);
  return form;
}

async function claim(page: Page, fields: ClaimFields = {}) {
  const form = await fillClaim(page, fields);
  await form.locator('button[type="submit"]').click();
  return form;
}

const success = (page: Page) => page.locator('[data-referral-redeem-success]');
const error = (page: Page) => page.locator('[data-referral-redeem-error]');

test('a valid code shows who referred you and the discount', async ({ page }) => {
  await page.goto(`/r/${REFERRAL.code}`);
  await expect(page).toHaveTitle(
    `${REFERRAL.displayName} gave you ${REFERRAL.discountPercent}% off | Pyre Sauna`
  );
  await expect(page.locator('h1').first()).toContainText(REFERRAL.displayName);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test.describe('the claim form', () => {
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
    await expect(success(page)).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].postDataJSON()).toMatchObject({ code: REFERRAL.code });
  });

  test('claiming the discount', async ({ page }) => {
    const requests = await stubJson(
      page,
      '**/api/referral-redemption',
      { ok: true },
      { method: 'POST' }
    );
    await page.goto(`/r/${REFERRAL.code}`);

    await claim(page);

    await expect(success(page)).toBeVisible();
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
    await expect(error(page)).toHaveText('Please enter a valid email.');
    expect(requests).toHaveLength(0);
  });

  // Policy rejections arrive as 200 { result } and show friendly copy, leaving
  // the form usable so a typo'd email can be fixed and claimed.
  for (const result of Object.keys(
    referral.form.rejections
  ) as (keyof typeof referral.form.rejections)[]) {
    test(`a "${result}" rejection explains itself, and a corrected claim goes through`, async ({
      page,
    }) => {
      const sent: Array<{ email?: string }> = [];
      await page.route('**/api/referral-redemption', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        sent.push(route.request().postDataJSON());
        return route.fulfill({ json: sent.length === 1 ? { ok: false, result } : { ok: true } });
      });
      await page.goto(`/r/${REFERRAL.code}`);

      const form = await claim(page);
      await expect(error(page)).toHaveText(referral.form.rejections[result]);
      await expect(form.locator('button[type="submit"]')).toBeEnabled();
      await expect(success(page)).toBeHidden();

      await claim(page, { email: 'sam.corrected@example.com' });
      await expect(success(page)).toBeVisible();
      expect(sent.map((body) => body.email)).toEqual([
        'sam@example.com',
        'sam.corrected@example.com',
      ]);
    });
  }

  test.describe('when the claim fails outright', () => {
    test.use({ consoleAllowlist: allowConsole(/status of 500/) });

    test('shows the generic error', async ({ page }) => {
      await stubJson(page, '**/api/referral-redemption', { ok: false }, { status: 500 });
      await page.goto(`/r/${REFERRAL.code}`);

      await claim(page);
      await expect(error(page)).toHaveText(referral.form.errorMessage);
    });
  });
});

test.describe('through the real route', () => {
  test('a claim reaches the integrations service under the canonical code', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'referral');
    await page.goto(`/r/${REFERRAL.code.toLowerCase()}`);

    const form = await fillClaim(page, { email: ` ${email.toUpperCase()} ` });
    await waitForFormReady(form);
    await form.locator('button[type="submit"]').click();

    await expect(success(page)).toBeVisible();
    const forwarded = await upstreamRequests(UPSTREAM, (body) => body.email === email);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].body).toEqual({
      code: REFERRAL.code,
      firstName: 'Sam',
      lastName: 'Tester',
      email,
    });
  });

  test('a policy rejection from the service shows its copy', async ({ page }, testInfo) => {
    // The mock rejects emails that start with a rejection's name.
    const email = uniqueEmail(testInfo, 'existing-customer');
    await page.goto(`/r/${REFERRAL.code}`);

    const form = await fillClaim(page, { email });
    await waitForFormReady(form);
    await form.locator('button[type="submit"]').click();

    await expect(error(page)).toHaveText(referral.form.rejections['existing-customer']);
    await expect(success(page)).toBeHidden();
    expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(1);
  });

  test('a bot that submits too fast is told it worked, and nothing is sent', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'referral-bot');
    await page.goto(`/r/${REFERRAL.code}`);

    const form = await fillClaim(page, { email });
    // The form leaves the timing check to the route: re-stamp the load time
    // so the submission lands well inside the 3s window.
    await form.locator('input[name="form_timestamp"]').evaluate((input: HTMLInputElement) => {
      input.value = String(Date.now());
    });
    await form.locator('button[type="submit"]').click();

    await expect(success(page)).toBeVisible();
    expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(0);
  });

  test.describe('when the integrations service is down', () => {
    test.use({ consoleAllowlist: allowConsole(/status of 502/) });

    test('says so, and a retry goes through', async ({ page }, testInfo) => {
      // The mock fails this email's first request only.
      const email = uniqueEmail(testInfo, UPSTREAM_EMAIL_LABEL.failOnce);
      await page.goto(`/r/${REFERRAL.code}`);

      const form = await fillClaim(page, { email });
      const submit = form.locator('button[type="submit"]');
      await waitForFormReady(form);
      await submit.click();

      await expect(error(page)).toHaveText('Something went wrong. Please try again later.');
      await expect(submit).toBeEnabled();

      await submit.click();
      await expect(success(page)).toBeVisible();
      expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(2);
    });
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
