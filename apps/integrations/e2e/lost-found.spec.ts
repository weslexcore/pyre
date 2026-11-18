// Lost and found: an item logged on the page is saved and opens on its own page.

import { uniqueTag } from '@pyre/e2e-utils';
import { ADMIN } from './roles';
import { expect, expectNoSidewaysScroll, open, test } from './test';

test.use({ storageState: ADMIN.storageState as string });

test('logging an item saves it and lists it', async ({ page, db, isMobile }, testInfo) => {
  // Long on purpose: the list truncates titles rather than widening the card.
  const title = uniqueTag(testInfo, 'insulated stainless steel water bottle with a carabiner');
  await open(page, '/admin/lost-found/new');

  await page.getByLabel('Item').fill(title);
  await page.getByRole('button', { name: 'Log the item' }).click();
  // The item's own page (by id). Not just any /lost-found/x: the form at
  // /lost-found/new also shows the title, in its email preview.
  await expect(page).toHaveURL(/\/admin\/lost-found\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const { data, error } = await db
    .from('lost_found_items')
    .select('status, logged_by')
    .eq('title', title)
    .single();
  expect(error).toBeNull();
  expect(data?.logged_by).toBe(ADMIN.email);

  // Logging navigates to the item page; let that finish before leaving it.
  await page.waitForLoadState('networkidle');
  await open(page, '/admin/lost-found');
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  if (isMobile) await expectNoSidewaysScroll(page);
});
