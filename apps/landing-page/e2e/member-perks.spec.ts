// Member perks (/perks): a Pyre member asks us to vouch for them at a partner.
// The page only collects partner + email; integrations emails the member a
// confirm link and, on click, tells the partner (covered by the integrations
// suite). These go through the real /api/member-perk route and check what it
// forwarded in the mock's request log, because a discarded bot submission is
// answered with the same success as a real one.

import type { Page } from '@playwright/test';
import { allowConsole, stubJson, TURNSTILE_SOLVED, uniqueEmail } from '@pyre/e2e-utils';
import { UPSTREAM_EMAIL_LABEL } from './mock-server/integrations-fixtures';
import { expect, test, upstreamRequests, waitForFormReady } from './test';

const UPSTREAM = '/integrations/api/partner/member-request';

const form = (page: Page) => page.locator('[data-member-perk-form]');
const submitButton = (page: Page) => form(page).locator('button[type="submit"]');
const success = (page: Page) => page.locator('[data-member-perk-success]');
const error = (page: Page) => page.locator('[data-member-perk-error]');

async function fill(page: Page, { partner, email }: { partner?: string; email: string }) {
  if (partner) await page.getByLabel('Partner').selectOption(partner);
  await page.getByLabel('The email you book with at Pyre').fill(email);
  // Focusing the form starts the (fake) Turnstile check; submit once it has a token.
  await expect(form(page).locator('xpath=..').locator(TURNSTILE_SOLVED)).toHaveCount(1);
  await waitForFormReady(form(page));
}

test('lists the partners and their perks', async ({ page }) => {
  await page.goto('/perks');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const name of ['BFT Carytown', 'Humble Haven Yoga', 'Embody Pilates']) {
    await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
  }
});

test("a partner card's claim link picks that partner in the form", async ({ page }) => {
  await page.goto('/perks');
  await page.getByRole('link', { name: 'Claim this perk at Embody Pilates' }).click();
  await expect(page.getByLabel('Partner')).toHaveValue('embody');
});

test('asks for a partner before sending', async ({ page }) => {
  const requests = await stubJson(page, '**/api/member-perk', { ok: true });
  await page.goto('/perks');
  await fill(page, { email: 'riley@example.com' });
  await submitButton(page).click();
  await expect(error(page)).toHaveText('Please choose a partner.');
  expect(requests).toHaveLength(0);
});

test('a request reaches the integrations service', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo, 'perk');
  await page.goto('/perks');
  await fill(page, { partner: 'bft', email: ` ${email.toUpperCase()} ` });
  await submitButton(page).click();

  await expect(success(page)).toContainText('Check your inbox');
  await expect(form(page)).toBeHidden();
  // Trimmed, lower-cased, and nothing else forwarded.
  const forwarded = await upstreamRequests(UPSTREAM, (body) => body.email === email);
  expect(forwarded).toHaveLength(1);
  expect(forwarded[0].body).toEqual({ partner: 'bft', email });
});

test('a bot that fills a honeypot is told it worked, and nothing is sent', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo, 'perk-bot');
  await page.goto('/perks');
  await fill(page, { partner: 'bft', email });
  await form(page)
    .locator('input[name="website_url"]')
    .evaluate((input: HTMLInputElement) => {
      input.value = 'https://spam.example';
    });
  await submitButton(page).click();

  await expect(success(page)).toBeVisible();
  expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(0);
});

test.describe('when the partner is not taking requests', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 409/) });

  test('says so', async ({ page }, testInfo) => {
    await page.goto('/perks');
    // A slug the mock answers as a partner without a member perk.
    await page.getByLabel('Partner').evaluate((select: HTMLSelectElement) => {
      select.add(new Option('Closed', 'closed-partner'));
    });
    await fill(page, { partner: 'closed-partner', email: uniqueEmail(testInfo, 'perk-closed') });
    await submitButton(page).click();
    await expect(error(page)).toContainText("isn't taking requests right now");
    await expect(submitButton(page)).toBeEnabled();
  });
});

test.describe('when the integrations service is down', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 502/) });

  test('says so, and a retry goes through', async ({ page }, testInfo) => {
    // The mock fails this email's first request only.
    const email = uniqueEmail(testInfo, UPSTREAM_EMAIL_LABEL.failOnce);
    await page.goto('/perks');
    await fill(page, { partner: 'humble-haven', email });
    await submitButton(page).click();

    await expect(error(page)).toHaveText('Something went wrong. Please try again later.');
    await submitButton(page).click();
    await expect(success(page)).toBeVisible();
    expect(await upstreamRequests(UPSTREAM, (body) => body.email === email)).toHaveLength(2);
  });
});
