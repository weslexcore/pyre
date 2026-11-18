// The integrations suite's `test`, built on @pyre/e2e-utils. Specs import
// from here, never from @playwright/test directly.

import type { Page } from '@playwright/test';
import {
  createTest,
  expect,
  mockServerClient,
  supabaseAdmin,
  waitForHydration,
} from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MOCK_URL, SUPABASE } from './env';

const base = createTest({
  consoleAllowlist: [
    // Vite's dev client chatter.
    /\[vite\]/,
  ],
});

export const test = base.extend<{ db: SupabaseClient }>({
  // Service-role client on the e2e stack: seed what a test needs, check what
  // the app wrote. Tests share one database, so seed under unique names
  // (uniqueEmail / uniqueTag) and never truncate.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  db: async ({}, use) => {
    await use(supabaseAdmin(SUPABASE));
  },
});

export { expect, expectNoSidewaysScroll, waitForHydration } from '@pyre/e2e-utils';

/** Open a page and wait for its islands, so typing into a React form sticks. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForHydration(page);
}

/** The mock upstreams' control API (requests received, overrides). */
export const mock = mockServerClient(MOCK_URL);

/** Open the dashboard's tool menu (the same control on desktop and phones). */
export async function openAdminMenu(page: Page) {
  await page.getByRole('button', { name: 'Open admin menu' }).click();
  const menu = page.locator('#admin-menu');
  await expect(menu).toBeVisible();
  return menu;
}
