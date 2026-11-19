// The water log beyond a plain test entry: the other entry types, dose
// recommendations taken or skipped, correcting and deleting your own entries
// (and not anyone else's), and the filtered CSV export.

import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { APP_URL } from './ports';
import { ADMIN, type Role, STAFF, STAFF_2 } from './roles';
import { expect, open, test } from './test';

test.use({ storageState: STAFF.storageState as string });

const DEFAULT_TUB = 'left';

async function logEntry(request: APIRequestContext, body: Record<string, unknown>) {
  const response = await request.post('/api/admin/water-tests', {
    data: { tub: DEFAULT_TUB, entryType: 'test', ...body },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { record: { id: string } }).record;
}

/** One entry's card in the log, found by its (unique) note. */
const entryCard = (page: Page, note: string) =>
  page.locator('div.rounded-lg').filter({ hasText: note }).last();

test('a shock entry saves the shock doses for the tub', async ({ page, db }, testInfo) => {
  const note = uniqueTag(testInfo, 'shock');
  await open(page, '/admin/water');

  await page.getByRole('button', { name: 'Shock', exact: true }).first().click();
  // The shock note is prefilled; ours replaces it so the row can be found.
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(/shock/i);
  await page.getByRole('textbox', { name: 'Notes' }).fill(note);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  const { data } = await db
    .from('water_tests')
    .select('entry_type, doses, ph, recorded_by')
    .eq('notes', note)
    .single();
  expect(data?.entry_type).toBe('shock');
  expect((data?.doses as unknown[]).length).toBeGreaterThan(0);
  expect(data?.recorded_by).toBe(STAFF.email);
});

test('an out-of-range reading recommends a dose that can be adjusted or skipped', async ({
  page,
  db,
}, testInfo) => {
  const adjusted = uniqueTag(testInfo, 'dose-adjusted');
  const skipped = uniqueTag(testInfo, 'dose-skipped');
  await open(page, '/admin/water');

  // Free chlorine well under target: a sanitizer dose.
  const enter = async (note: string) => {
    await page.getByPlaceholder('1–3').fill('0.2');
    await page.getByRole('textbox', { name: 'Notes' }).fill(note);
    await page.getByRole('button', { name: 'Check readings' }).click();
    await expect(page.getByRole('button', { name: 'Adding' }).first()).toBeVisible();
  };

  await enter(adjusted);
  const grams = page.locator('input[inputmode="decimal"]').last();
  await grams.fill('42');
  await expect(page.getByText(/\(chart: \d+(\.\d+)? g\)/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText(/^Saved\. Run pumps/)).toBeVisible();

  await enter(skipped);
  for (const adding of await page.getByRole('button', { name: 'Adding' }).all())
    await adding.click();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText(/^Saved\.$/)).toBeVisible();

  const { data } = await db
    .from('water_tests')
    .select('notes, doses')
    .or(`notes.like.${adjusted}*,notes.like.${skipped}*`);
  const byNote = (tag: string) =>
    (data ?? []).find((row) => String(row.notes).startsWith(tag))?.doses as {
      grams: number;
      recommended_grams: number | null;
    }[];
  expect(byNote(adjusted).some((dose) => dose.grams === 42)).toBe(true);
  expect(byNote(skipped)).toEqual([]);
});

test('a filter entry records what was done to the filter, and no readings', async ({
  page,
  db,
}, testInfo) => {
  const note = uniqueTag(testInfo, 'filter');
  await open(page, '/admin/water');

  // The entry form's Filter (the log's type filter below has one too).
  await page.getByRole('button', { name: 'Filter', exact: true }).first().click();
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes' }).fill(note);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  const { data } = await db
    .from('water_tests')
    .select('entry_type, filter_action, ph')
    .eq('notes', note)
    .single();
  expect(data).toEqual({ entry_type: 'filter', filter_action: 'changed', ph: null });
});

test.describe('the entry API', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a filter entry needs a valid filter action', async ({ page }) => {
    const response = await page.request.post('/api/admin/water-tests', {
      data: { tub: DEFAULT_TUB, entryType: 'filter', filterAction: 'replaced' },
    });
    expect(response.status()).toBe(400);
  });

  test('a drain/refill entry drops any readings sent with it', async ({ page, db }, testInfo) => {
    const record = await logEntry(page.request, {
      entryType: 'refill',
      readings: { ph: 7.4, chlorine: 2 },
      notes: uniqueTag(testInfo, 'refill'),
    });
    const { data } = await db
      .from('water_tests')
      .select('entry_type, ph, free_chlorine_ppm')
      .eq('id', record.id)
      .single();
    expect(data).toEqual({ entry_type: 'refill', ph: null, free_chlorine_ppm: null });
  });

  test('a test entry needs at least one reading', async ({ page }) => {
    const response = await page.request.post('/api/admin/water-tests', {
      data: { tub: DEFAULT_TUB, entryType: 'test', readings: {} },
    });
    expect(response.status()).toBe(400);
  });
});

test('you can correct and delete your own entry', async ({ page, db }, testInfo) => {
  const note = uniqueTag(testInfo, 'mine');
  const corrected = `${note} corrected`;
  const record = await logEntry(page.request, { readings: { ph: 7.4 }, notes: note });

  await open(page, '/admin/water');
  const card = entryCard(page, note);
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await card.getByRole('textbox', { name: 'Notes' }).fill(corrected);
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(entryCard(page, corrected)).toBeVisible();
  await expect
    .poll(
      async () => (await db.from('water_tests').select('notes').eq('id', record.id).single()).data
    )
    .toEqual({ notes: corrected });

  await entryCard(page, corrected).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(corrected)).toHaveCount(0);
  await expect
    .poll(async () => (await db.from('water_tests').select('id').eq('id', record.id)).data)
    .toEqual([]);
});

test("nobody can change or delete someone else's entry, not even an admin", async ({
  page,
  as,
  db,
}, testInfo) => {
  const note = uniqueTag(testInfo, 'theirs');
  const colleague = await as(STAFF_2);
  const record = await logEntry(colleague, { readings: { ph: 7.5 }, notes: note });
  await colleague.dispose();

  // No Edit or Delete on their card.
  await open(page, '/admin/water');
  await expect(entryCard(page, note)).toBeVisible();
  await expect(
    entryCard(page, note).getByRole('button', { name: 'Edit', exact: true })
  ).toHaveCount(0);

  const admin = await as(ADMIN);
  const patch = await admin.patch(`/api/admin/water-tests?id=${record.id}`, {
    data: { notes: 'overwritten' },
  });
  const remove = await admin.delete(`/api/admin/water-tests?id=${record.id}`);
  await admin.dispose();
  expect(patch.status()).toBe(403);
  expect(remove.status()).toBe(403);
  expect((await db.from('water_tests').select('notes').eq('id', record.id).single()).data).toEqual({
    notes: note,
  });
});

test('the CSV export follows the filters', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'A file download; one device is enough.');
  const filterNote = uniqueTag(testInfo, 'csv-filter');
  const testNote = uniqueTag(testInfo, 'csv-test');
  await logEntry(page.request, { entryType: 'filter', filterAction: 'rinsed', notes: filterNote });
  await logEntry(page.request, { readings: { ph: 7.3 }, notes: testNote });

  await open(page, '/admin/water');
  await page.getByRole('button', { name: 'Filter', exact: true }).last().click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^water-log-.*filter.*\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain(filterNote);
  expect(csv).not.toContain(testNote);
});
