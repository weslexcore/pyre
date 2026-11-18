// Staff sign-in (Supabase Auth on the e2e stack): the login page, the redirect
// back to where someone was going, sign-in by password and by emailed link,
// and sign-out.

import { allowConsole, emailLinks, mailpitClient } from '@pyre/e2e-utils';
import { SUPABASE } from './env';
import { PASSWORD, ROSTER_ONLY, signInRole, WATER_STAFF } from './roles';
import { expect, open, openAdminMenu, test } from './test';

const mailpit = mailpitClient(SUPABASE.mailpitUrl);

test('signed out, an admin page sends you to sign in and back', async ({ page }) => {
  await page.goto('/admin/water');
  await expect(page).toHaveURL(/\/\?returnUrl=%2Fadmin%2Fwater$/);
  await expect(page.getByRole('heading', { name: 'Pyre Admin' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
});

test('a password signs you in and returns you to the page', async ({ page }) => {
  await open(page, '/admin/water');
  await page.getByRole('tab', { name: /password/i }).click();
  await page.getByLabel('Email').fill(WATER_STAFF.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/water$/);
});

test.describe('a wrong password', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 400 .*\/api\/auth\/password/) });

  test('is refused', async ({ page }) => {
    await open(page, '/');
    await page.getByRole('tab', { name: /password/i }).click();
    await page.getByLabel('Email').fill(WATER_STAFF.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  });
});

test('the emailed link signs you in', async ({ page }, testInfo) => {
  const role = signInRole(testInfo.project.name, 'link');
  const since = new Date();

  await open(page, '/admin/water');
  await page.getByLabel('Email').fill(role.email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByText(`Sent to ${role.email}`)).toBeVisible();

  const email = await mailpit.waitForMessage(role.email, { since });
  const link = emailLinks(email).find((href) => href.includes('/api/auth/callback'));
  expect(link, 'sign-in link in the email').toBeTruthy();
  await page.goto(link as string);
  await expect(page).toHaveURL(/\/admin\/water$/);
});

test('the code from the email signs you in', async ({ page }, testInfo) => {
  const role = signInRole(testInfo.project.name, 'code');
  const since = new Date();

  await open(page, '/');
  await page.getByLabel('Email').fill(role.email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  const email = await mailpit.waitForMessage(role.email, { since });
  const code = email.Text.match(/\b(\d{6})\b/)?.[1];
  expect(code, 'six-digit code in the email').toBeTruthy();

  await page.getByLabel('Six-digit code').fill(code as string);
  await page.getByRole('button', { name: 'Sign in with code' }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test('an email not on staff gets the same answer, and no email', async ({ page }) => {
  const stranger = `stranger-${Date.now()}@e2e.test`;
  await open(page, '/');
  await page.getByLabel('Email').fill(stranger);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByText(`Sent to ${stranger}`)).toBeVisible();
  expect(await mailpit.messagesTo(stranger)).toHaveLength(0);
});

test.describe('signed in', () => {
  // Logging out is a full reload (data-astro-reload). WebKit reports the lazy
  // island imports it cancels as failed; nothing failed to load.
  test.use({ consoleAllowlist: allowConsole('Importing a module script failed') });

  test('the login page sends you on, and logging out ends the session', async ({ page }) => {
    // A session of its own (not a shared storageState), since it ends it.
    const signIn = await page.request.post('/api/auth/password', {
      data: { email: WATER_STAFF.email, password: PASSWORD },
    });
    expect(signIn.status()).toBe(200);

    await open(page, '/');
    await expect(page).toHaveURL(/\/admin$/);

    const menu = await openAdminMenu(page);
    await menu.getByRole('button', { name: 'Log Out' }).click();
    await expect(page.getByRole('heading', { name: 'Pyre Admin' })).toBeVisible();
    await page.goto('/admin/water');
    await expect(page).toHaveURL(/\/\?returnUrl=/);
  });
});

test.describe('signed in without dashboard access', () => {
  test.use({ storageState: ROSTER_ONLY.storageState as string });

  test('says so', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Unauthorized' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${ROSTER_ONLY.email}`)).toBeVisible();
  });
});
