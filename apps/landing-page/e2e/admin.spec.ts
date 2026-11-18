// The admin dashboard gates on the session, then on /api/admin/check.

import { allowConsole, stubJson } from '@pyre/e2e-utils';
import { expect, test } from './test';

test('signed out, it asks for a login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
});

test.describe('signed in without admin access', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 403/) });

  test('says so', async ({ page }) => {
    await stubJson(page, '**/api/auth/session', {
      isAuthenticated: true,
      user: { id: 1, email: 'guest@example.com', firstName: 'Guest', lastName: 'User' },
      expiresAt: Date.now() + 3_600_000,
    });
    await stubJson(
      page,
      '**/api/admin/check',
      { error: 'forbidden', detected: { email: 'guest@example.com', userId: 1 } },
      { status: 403 }
    );

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Unauthorized' })).toBeVisible();
    await expect(page.getByText('Signed in as guest@example.com')).toBeVisible();
  });
});

test('the admin API refuses an anonymous caller', async ({ request }) => {
  const response = await request.get('/api/admin/check');
  expect(response.status()).toBe(401);
});
