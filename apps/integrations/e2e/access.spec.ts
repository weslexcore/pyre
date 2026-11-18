// Who can open what: page grants decide the nav and the pages, and the admin
// API checks the same grants on its own.

import { DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import { WATER_STAFF } from './roles';
import { expect, open, openAdminMenu, test } from './test';

test.describe('staff with one page', () => {
  test.use({ storageState: WATER_STAFF.storageState as string });

  test('see only that tool in the menu', async ({ page }) => {
    await open(page, '/admin/water');
    await expect(page).toHaveTitle(/Pyre Admin/);
    const menu = await openAdminMenu(page);
    await expect(menu.getByRole('link', { name: /water/i }).first()).toBeVisible();
    await expect(menu.getByRole('link', { name: /settings/i })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: /users/i })).toHaveCount(0);
  });

  test('are told a page they lack is unauthorized', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Unauthorized' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${WATER_STAFF.email}`)).toBeVisible();
  });

  test('can call the API behind their page, not another', { tag: DESKTOP_ONLY_TAG }, async ({
    page,
  }) => {
    expect((await page.request.get('/api/admin/water-tests')).status()).toBe(200);
    expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  });
});

test('the admin API refuses an anonymous caller', { tag: DESKTOP_ONLY_TAG }, async ({
  request,
}) => {
  const response = await request.get('/api/admin/water-tests');
  expect(response.status()).toBe(401);
});
