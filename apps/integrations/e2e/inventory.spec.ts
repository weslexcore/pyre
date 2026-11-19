// Inventory: counting stock inline (the job staff do), the low-stock alert
// to admins, the due-for-count and re-order views, and who may configure.
// Each test seeds items of its own under a unique tag and searches for it.

import type { Page } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN, MANAGER, STAFF } from './roles';
import { expect, open, test } from './test';

test.use({ storageState: STAFF.storageState as string });

const DAY = 24 * 60 * 60 * 1000;

interface ItemInput {
  name: string;
  in_stock?: number;
  reorder_at?: number | null;
  count_every_days?: number | null;
  last_counted_at?: string | null;
}

async function seedItem(db: SupabaseClient, input: ItemInput): Promise<string> {
  const { data, error } = await db
    .from('inventory')
    .insert({
      in_stock: 10,
      reorder_at: null,
      count_every_days: 7,
      last_counted_at: new Date().toISOString(),
      created_by: 'e2e',
      active: true,
      ...input,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** Open the list narrowed to this test's items. */
async function openFiltered(page: Page, search: string, path = '/admin/inventory') {
  await open(page, path);
  await page
    .getByRole('searchbox', { name: 'Search inventory' })
    .or(page.getByLabel('Search inventory'))
    .first()
    .fill(search);
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test('counting an item saves the count and its history', async ({ page, db }, testInfo) => {
  const name = uniqueTag(testInfo, 'Towels');
  const id = await seedItem(db, { name, in_stock: 10 });
  await openFiltered(page, name);

  await row(page, name)
    .getByRole('button', { name: `In stock for ${name}: 10. Edit` })
    .click();
  await row(page, name).getByLabel(`In stock for ${name}`, { exact: true }).fill('7');
  await page.keyboard.press('Enter');
  await expect(
    row(page, name).getByRole('button', { name: `In stock for ${name}: 7. Edit` })
  ).toBeVisible();

  await expect
    .poll(
      async () =>
        (await db.from('inventory').select('in_stock, last_counted_by').eq('id', id).single()).data
    )
    .toEqual({ in_stock: 7, last_counted_by: STAFF.email });
  await expect
    .poll(
      async () =>
        (await db.from('inventory_history').select('in_stock, changed_by').eq('item_id', id)).data
    )
    .toContainEqual({ in_stock: 7, changed_by: STAFF.email });
});

test('Escape leaves the count as it was', async ({ page, db }, testInfo) => {
  const name = uniqueTag(testInfo, 'Robes');
  const id = await seedItem(db, { name, in_stock: 10 });
  await openFiltered(page, name);

  await row(page, name)
    .getByRole('button', { name: `In stock for ${name}: 10. Edit` })
    .click();
  await row(page, name).getByLabel(`In stock for ${name}`, { exact: true }).fill('3');
  await page.keyboard.press('Escape');
  await expect(
    row(page, name).getByRole('button', { name: `In stock for ${name}: 10. Edit` })
  ).toBeVisible();
  expect((await db.from('inventory').select('in_stock').eq('id', id).single()).data).toEqual({
    in_stock: 10,
  });
});

test(
  'dropping to the re-order level tells the admins',
  { tag: DESKTOP_ONLY_TAG },
  async ({ page, db }, testInfo) => {
    const name = uniqueTag(testInfo, 'Electrolytes');
    const id = await seedItem(db, { name, in_stock: 10, reorder_at: 5 });

    const response = await page.request.patch(`/api/admin/inventory?id=${id}`, {
      data: { in_stock: 4 },
    });
    expect(response.status()).toBe(200);

    await expect
      .poll(async () => {
        const { data } = await db
          .from('staff_notifications')
          .select('recipient_email, kind')
          .eq('source_id', id);
        return (data ?? []).map((n) => `${n.kind}:${n.recipient_email}`);
      })
      .toContain(`inventory_low:${ADMIN.email}`);
  }
);

test('the due-for-count and re-order views, by button and by link', async ({
  page,
  db,
}, testInfo) => {
  const tag = uniqueTag(testInfo, 'Views');
  const due = `${tag} due`;
  const low = `${tag} low`;
  const fine = `${tag} fine`;
  await seedItem(db, {
    name: due,
    count_every_days: 7,
    last_counted_at: new Date(Date.now() - 30 * DAY).toISOString(),
  });
  await seedItem(db, { name: low, in_stock: 1, reorder_at: 5 });
  await seedItem(db, { name: fine, in_stock: 10, reorder_at: 2 });

  await openFiltered(page, tag);
  await expect(row(page, fine)).toBeVisible();
  await page.getByRole('button', { name: /^Due for a count/ }).click();
  await expect(row(page, due)).toBeVisible();
  await expect(row(page, fine)).toHaveCount(0);
  await page.getByRole('button', { name: /^Needs re-order/ }).click();
  await expect(row(page, low)).toBeVisible();
  await expect(row(page, due)).toHaveCount(0);

  // The low-stock alert links here.
  await openFiltered(page, tag, '/admin/inventory?filter=reorder');
  await expect(row(page, low)).toBeVisible();
  await expect(row(page, fine)).toHaveCount(0);
});

test.describe('staff', { tag: DESKTOP_ONLY_TAG }, () => {
  test('can count, but not configure, add or delete', async ({ page, db }, testInfo) => {
    const id = await seedItem(db, { name: uniqueTag(testInfo, 'Staff limits') });
    expect(
      (
        await page.request.patch(`/api/admin/inventory?id=${id}`, { data: { in_stock: 9 } })
      ).status()
    ).toBe(200);
    expect(
      (
        await page.request.patch(`/api/admin/inventory?id=${id}`, { data: { reorder_at: 3 } })
      ).status()
    ).toBe(403);
    expect(
      (await page.request.post('/api/admin/inventory', { data: { name: 'Nope' } })).status()
    ).toBe(403);
    expect((await page.request.delete(`/api/admin/inventory?id=${id}`)).status()).toBe(403);
  });
});

test.describe('a manager', () => {
  test.use({ storageState: MANAGER.storageState as string });

  test('adds an item, configures it, and deletes it', async ({ page, db }, testInfo) => {
    const name = uniqueTag(testInfo, 'Sea salt');
    await open(page, '/admin/inventory');
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByLabel('New item name').fill(name);
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => (await db.from('inventory').select('id').eq('name', name)).data?.length)
      .toBe(1);
    const { data: item } = await db.from('inventory').select('id').eq('name', name).single();
    const id = (item as { id: string }).id;

    const configure = await page.request.patch(`/api/admin/inventory?id=${id}`, {
      data: { reorder_at: 4, vendor: 'Salt Co' },
    });
    expect(configure.status()).toBe(200);

    await page.getByLabel('Search inventory').fill(name);
    // Delete by keyboard, as the menu supports: it focuses its first item on
    // open and closes on any scroll, and a scripted click scrolls the item
    // into view first (on the Pixel profile that closes it). Delete is last,
    // so ArrowUp wraps to it. Retried as a whole: the row re-renders as the
    // saved item comes back, which can close a menu opened too early.
    await expect(async () => {
      if (!(await page.getByRole('menuitem', { name: 'Delete' }).isVisible())) {
        await page.getByRole('button', { name: `Options for ${name}` }).click();
      }
      await page.keyboard.press('ArrowUp');
      await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    // Deleting asks with the browser's own confirm().
    page.once('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Enter');
    await expect(row(page, name)).toHaveCount(0);
    await expect
      .poll(async () => (await db.from('inventory').select('id').eq('id', id)).data)
      .toEqual([]);
  });
});
