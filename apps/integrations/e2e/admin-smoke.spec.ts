// Every dashboard page opens for an admin: each tool, the pages nested under
// them (calendar, timesheet, plunges, check-ins, ...), home, messages and
// notifications. The list is the admin's own page search (searchablePages),
// so a new page is covered without touching this file. Each renders inside
// the admin layout against the real (local) database, with no browser
// errors, and on a phone nothing scrolls sideways.

import { allowConsole, type ConsolePattern } from '@pyre/e2e-utils';
import { ADMIN_TOOLS, searchablePages } from '../src/components/admin/adminTools';
import { ADMIN } from './roles';
import { expect, expectNoSidewaysScroll, test, waitForHydration } from './test';

test.use({ storageState: ADMIN.storageState as string });

/** Browser errors a page is known to log under `astro dev`, with why. */
const EXPECTED_ERRORS: Record<string, ConsolePattern[]> = {
  // The preview iframe is sandboxed, so its images are cross-site requests,
  // which the dev server refuses (403). Vercel serves them.
  '/admin/email-templates': [/status of 403 .*\/email\//],
};

const PAGES = [
  ...new Set(
    searchablePages(ADMIN_TOOLS, { isAdmin: true, pages: ADMIN.pages }).map((page) => page.href)
  ),
];

for (const href of PAGES) {
  test.describe(href, () => {
    test.use({ consoleAllowlist: allowConsole(...(EXPECTED_ERRORS[href] ?? [])) });

    test('opens', async ({ page, isMobile }) => {
      const response = await page.goto(href);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/— Pyre Admin$/);
      await expect(page.getByRole('heading', { name: 'Unauthorized' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open admin menu' })).toBeVisible();
      await waitForHydration(page);
      // Let the page's own requests settle, but don't wait on pages that poll.
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      if (isMobile) await expectNoSidewaysScroll(page);
    });
  });
}
