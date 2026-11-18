// Every dashboard tool opens for an admin: the page renders inside the admin
// layout against the real (local) database, with no browser errors, and on a
// phone nothing scrolls sideways.

import { allowConsole, type ConsolePattern } from '@pyre/e2e-utils';
import { ADMIN_TOOLS } from '../src/components/admin/adminTools';
import { ADMIN } from './roles';
import { expect, expectNoSidewaysScroll, test, waitForHydration } from './test';

test.use({ storageState: ADMIN.storageState as string });

/** Browser errors a page is known to log under `astro dev`, with why. */
const EXPECTED_ERRORS: Record<string, ConsolePattern[]> = {
  // The preview iframe is sandboxed, so its images are cross-site requests,
  // which the dev server refuses (403). Vercel serves them.
  '/admin/email-templates': [/status of 403 .*\/email\//],
};

for (const tool of ADMIN_TOOLS) {
  test.describe(tool.href, () => {
    test.use({ consoleAllowlist: allowConsole(...(EXPECTED_ERRORS[tool.href] ?? [])) });

    test('opens', async ({ page, isMobile }) => {
      const response = await page.goto(tool.href);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/— Pyre Admin$/);
      await expect(page.getByRole('heading', { name: 'Unauthorized' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open admin menu' })).toBeVisible();
      await waitForHydration(page);
      await page.waitForLoadState('networkidle');
      if (isMobile) await expectNoSidewaysScroll(page);
    });
  });
}
