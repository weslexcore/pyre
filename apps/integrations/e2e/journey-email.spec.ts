// The journey step email editor: the header logo can be Pyre's, none, or an
// uploaded one, the same as on a newsletter.

import { allowConsole, DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { ADMIN } from './roles';
import { expect, open, test } from './test';

/** A 1x1 PNG, for the upload. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('a journey email', { tag: DESKTOP_ONLY_TAG }, () => {
  test.use({
    storageState: ADMIN.storageState as string,
    // The preview frame is sandboxed (a null origin), and the dev server
    // refuses its image requests; a deployment serves them as static files.
    consoleAllowlist: allowConsole(/status of 403 .*\/email\//),
  });

  test('can use its own header logo, or none', async ({ page, db }, testInfo) => {
    const name = uniqueTag(testInfo, 'e2e logo');
    await open(page, '/admin/journeys');
    await page.getByRole('button', { name: 'New journey' }).click();
    await page.getByPlaceholder('e.g. Lapsed members').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/admin\/journeys\/[a-z0-9-]+$/);
    const id = page.url().split('/').pop() as string;

    try {
      const preview = page.frameLocator('iframe[title="Email preview"]');
      const logo = page.getByLabel('Logo', { exact: true });
      await expect(logo).toHaveValue('pyre');
      await expect(preview.getByRole('img', { name: 'Pyre' })).toHaveAttribute(
        'src',
        /logo-header-creme\.png$/
      );

      await logo.selectOption('own');
      await page.getByLabel('Upload a logo').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      });
      const own = (await page
        .getByRole('img', { name: 'Your logo' })
        .getAttribute('src')) as string;
      expect(own).toMatch(/\/email-media\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/);
      await expect(preview.getByRole('img', { name: 'Pyre' })).toHaveAttribute('src', own);

      await logo.selectOption('none');
      await expect(preview.getByRole('img', { name: 'Pyre' })).toHaveCount(0);
    } finally {
      await db.from('journeys').delete().eq('id', id);
    }
  });
});
