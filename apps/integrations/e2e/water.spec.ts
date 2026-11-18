// The water log: a reading entered on the page is saved to the database.

import { uniqueTag } from '@pyre/e2e-utils';
import { WATER_STAFF } from './roles';
import { expect, open, test } from './test';

test.use({ storageState: WATER_STAFF.storageState as string });

test('logging a test saves the readings', async ({ page, db }, testInfo) => {
  const note = uniqueTag(testInfo, 'water');
  await open(page, '/admin/water');

  await page.getByPlaceholder('7.2–7.8').fill('7.4');
  await page.getByPlaceholder('1–3').fill('2');
  await page.getByRole('textbox', { name: 'Notes' }).fill(note);
  await page.getByRole('button', { name: 'Check readings' }).click();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();

  const { data, error } = await db
    .from('water_tests')
    .select('ph, free_chlorine_ppm, entry_type, recorded_by')
    .eq('notes', note)
    .single();
  expect(error).toBeNull();
  expect(data).toMatchObject({
    ph: 7.4,
    free_chlorine_ppm: 2,
    entry_type: 'test',
    recorded_by: WATER_STAFF.email,
  });
});
