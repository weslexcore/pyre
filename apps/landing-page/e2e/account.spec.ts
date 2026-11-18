// /account. Momence OAuth isn't exercised (it needs real client credentials);
// the session and member APIs are stubbed to drive the signed-in UI.

import type { Page } from '@playwright/test';
import { allowConsole, stubJson } from '@pyre/e2e-utils';
import { expect, test } from './test';

test('signed out, it offers login and sign-up', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
});

async function signIn(page: Page) {
  await stubJson(page, '**/api/auth/session', {
    isAuthenticated: true,
    user: { id: 4242, email: 'member@example.com', firstName: 'Morgan', lastName: 'Member' },
    expiresAt: Date.now() + 3_600_000,
  });
  await stubJson(page, '**/api/member/memberships', { memberships: [], credits: null });
  await stubJson(page, '**/api/member/credits', { credits: null });
  await stubJson(page, '**/api/member/sessions?*', { sessions: [] });
  await stubJson(page, '**/api/member/referral', { error: 'unavailable' }, { status: 404 });
}

test.describe('signed in', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 404/) });

  test('shows the dashboard', async ({ page }) => {
    await signIn(page);
    await page.goto('/account');

    await expect(page.getByRole('heading', { name: 'Welcome back, Morgan' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming Sessions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage Sessions' })).toHaveAttribute(
      'href',
      'https://momence.com/dashboard/u/4242/my-events'
    );
  });
});
