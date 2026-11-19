// Managing the cold plunges (admins only): add, rename and resize, archive
// (which stops new entries), reorder, and delete only while a plunge has no
// entries. Every test works on plunges of its own; the seeded Left and Right
// tubs that other specs log to are never touched.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN, STAFF } from './roles';
import { expect, open, test } from './test';

test.use({ storageState: ADMIN.storageState as string });

interface Plunge {
  id: string;
  name: string;
  gallons: number;
  archived: boolean;
  sort_order: number;
}

async function addPlunge(request: APIRequestContext, name: string, gallons = 100): Promise<Plunge> {
  const response = await request.post('/api/admin/cold-plunges', { data: { name, gallons } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { plunge: Plunge }).plunge;
}

/** Tidy up: a plunge with no entries can be deleted outright; else archive it. */
async function removePlunge(request: APIRequestContext, db: SupabaseClient, id: string) {
  const response = await request.delete(`/api/admin/cold-plunges?id=${id}`);
  if (response.status() === 409) {
    await db.from('cold_plunges').update({ archived: true }).eq('id', id);
  }
}

test('an admin adds a plunge, then renames and resizes it', async ({ page, db }, testInfo) => {
  const name = uniqueTag(testInfo, 'Garden');
  const renamed = `${name} renamed`;
  await open(page, '/admin/water/plunges');

  await page.getByPlaceholder('e.g. Garden plunge').fill(name);
  await page.getByLabel('Gallons').last().fill('90');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row).toBeVisible();
  // Edit stays disabled until the add has saved (the click waits for it).
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const editing = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Save' }) });
  await editing.getByLabel('Name').fill(renamed);
  await editing.getByLabel('Gallons').fill('110');
  await editing.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: renamed })).toBeVisible();

  // The row updates before the save lands; wait for the plunge itself.
  let id = '';
  await expect
    .poll(async () => {
      const { data } = await db
        .from('cold_plunges')
        .select('id, gallons')
        .eq('name', renamed)
        .maybeSingle();
      id = (data?.id as string) ?? '';
      return Number(data?.gallons);
    })
    .toBe(110);
  await removePlunge(page.request, db, id);
});

test('an archived plunge takes no new entries until restored', async ({ page, db }, testInfo) => {
  const plunge = await addPlunge(page.request, uniqueTag(testInfo, 'Archive me'));
  await open(page, '/admin/water/plunges');

  const row = page.getByRole('listitem').filter({ hasText: plunge.name });
  await row.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: plunge.name })
      .getByRole('button', { name: 'Restore', exact: true })
  ).toBeVisible();

  await expect
    .poll(
      async () =>
        (await db.from('cold_plunges').select('archived').eq('id', plunge.id).single()).data
    )
    .toEqual({ archived: true });
  const refused = await page.request.post('/api/admin/water-tests', {
    data: { tub: plunge.id, entryType: 'test', readings: { ph: 7.4 } },
  });
  expect(refused.status()).toBe(400);

  await page
    .getByRole('listitem')
    .filter({ hasText: plunge.name })
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: plunge.name })
      .getByRole('button', { name: 'Archive', exact: true })
  ).toBeVisible();
  // The button flips before the save lands; wait for the plunge itself.
  await expect
    .poll(
      async () =>
        (await db.from('cold_plunges').select('archived').eq('id', plunge.id).single()).data
    )
    .toEqual({ archived: false });
  const accepted = await page.request.post('/api/admin/water-tests', {
    data: { tub: plunge.id, entryType: 'test', readings: { ph: 7.4 } },
  });
  expect(accepted.status()).toBe(201);
  await removePlunge(page.request, db, plunge.id);
});

test(
  'a plunge with entries in its log cannot be deleted',
  { tag: DESKTOP_ONLY_TAG },
  async ({ page, db }, testInfo) => {
    const plunge = await addPlunge(page.request, uniqueTag(testInfo, 'Has entries'));
    const entry = await page.request.post('/api/admin/water-tests', {
      data: { tub: plunge.id, entryType: 'test', readings: { ph: 7.4 } },
    });
    expect(entry.status()).toBe(201);

    expect((await page.request.delete(`/api/admin/cold-plunges?id=${plunge.id}`)).status()).toBe(
      409
    );
    expect((await db.from('cold_plunges').select('id').eq('id', plunge.id)).data).toHaveLength(1);
    await removePlunge(page.request, db, plunge.id);
  }
);

// Re-ordering rewrites every plunge's position, so it runs on one device only,
// and sends the whole list (as the page does) rather than clicking "Move up":
// a plunge another test adds in between would make a click swap with that.
test('plunges can be re-ordered', { tag: DESKTOP_ONLY_TAG }, async ({ page, db }, testInfo) => {
  const first = await addPlunge(page.request, uniqueTag(testInfo, 'Order A'));
  const second = await addPlunge(page.request, uniqueTag(testInfo, 'Order B'));
  await open(page, '/admin/water/plunges');
  await expect(page.getByRole('button', { name: `Move ${second.name} up` })).toBeVisible();

  // The order covers every plunge, so a re-order from another test running
  // at the same time can overwrite this one: re-read and retry until ours sticks.
  await expect(async () => {
    const { plunges } = (await (await page.request.get('/api/admin/cold-plunges')).json()) as {
      plunges: Plunge[];
    };
    const ids = plunges.map((p) => p.id).filter((id) => id !== second.id);
    ids.splice(ids.indexOf(first.id), 0, second.id);
    const reorder = await page.request.patch('/api/admin/cold-plunges', { data: { order: ids } });
    expect(reorder.status()).toBe(200);
    const { data } = await db
      .from('cold_plunges')
      .select('id, sort_order')
      .in('id', [first.id, second.id]);
    const order = new Map((data ?? []).map((row) => [row.id, row.sort_order as number]));
    expect(order.get(second.id) ?? 0).toBeLessThan(order.get(first.id) ?? 0);
  }).toPass({ timeout: 15_000 });

  // The seeded tubs keep their place at the top.
  const { data: top } = await db
    .from('cold_plunges')
    .select('id')
    .eq('archived', false)
    .order('sort_order')
    .order('created_at')
    .limit(2);
  expect((top ?? []).map((row) => row.id)).toEqual(['left', 'right']);

  await removePlunge(page.request, db, first.id);
  await removePlunge(page.request, db, second.id);
});

test.describe('staff', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('are sent back to the water log from plunge management', async ({ page }) => {
    await page.goto('/admin/water/plunges');
    await expect(page).toHaveURL(/\/admin\/water$/);
  });

  test('cannot change plunges through the API', { tag: DESKTOP_ONLY_TAG }, async ({ page }) => {
    const response = await page.request.post('/api/admin/cold-plunges', {
      data: { name: 'Not allowed', gallons: 100 },
    });
    expect(response.status()).toBe(403);
  });
});
