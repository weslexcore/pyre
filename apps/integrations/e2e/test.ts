// The integrations suite's `test`, built on @pyre/e2e-utils. Specs import
// from here, never from @playwright/test directly.

import { type APIRequestContext, type Page, request as playwrightRequest } from '@playwright/test';
import {
  createTest,
  expect,
  type MockOverride,
  mockServerClient,
  supabaseAdmin,
  waitForHydration,
} from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_URL, MOCK_URL, SUPABASE } from './env';
import type { Role } from './roles';

const base = createTest({
  consoleAllowlist: [
    // Vite's dev client chatter.
    /\[vite\]/,
  ],
});

/** An upstream failure for one test: `bodyIncludes` ties it to that test's own request. */
export type UpstreamFailure = Omit<MockOverride, 'bodyIncludes'> & {
  /** A string only this test's request carries (its unique email, an entity id in the path). */
  bodyIncludes: string;
  /** Defaults to 503. */
  status?: number;
};

interface Fixtures {
  db: SupabaseClient;
  /** An API client signed in as `role` (its saved session), closed when the test ends. */
  as: (role: Role) => Promise<APIRequestContext>;
  /**
   * A page signed in as `role` beside the test's own `page` (a second person
   * on the same device), with the same request blocking and error guard.
   */
  pageAs: (role: Role) => Promise<Page>;
  /**
   * Make upstream calls (Momence, Resend) fail for this test only. Each
   * failure is scoped to requests carrying `bodyIncludes` and removed when
   * the test ends, so tests running beside it never see it.
   */
  upstream: { fail: (failure: UpstreamFailure) => Promise<void> };
}

export const test = base.extend<Fixtures>({
  // Service-role client on the e2e stack: seed what a test needs, check what
  // the app wrote. Tests share one database, so seed under unique names
  // (uniqueEmail / uniqueTag) and never truncate.
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  db: async ({}, use) => {
    await use(supabaseAdmin(SUPABASE));
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  as: async ({}, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role) => {
      if (!role.storageState) throw new Error(`${role.email} has no saved session`);
      const context = await playwrightRequest.newContext({
        baseURL: APP_URL,
        storageState: role.storageState,
      });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.dispose()));
  },
  pageAs: async ({ newPage }, use) => {
    await use(async (role) => {
      if (!role.storageState) throw new Error(`${role.email} has no saved session`);
      return newPage({ storageState: role.storageState });
    });
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  upstream: async ({}, use) => {
    const ids: string[] = [];
    await use({
      fail: async ({ status = 503, json, ...failure }) => {
        ids.push(
          await mock.override({
            status,
            json: json ?? { message: 'E2E upstream failure' },
            ...failure,
          })
        );
      },
    });
    await Promise.all(ids.map((id) => mock.removeOverride(id)));
  },
});

export {
  clickAndHydrate,
  expect,
  expectNoSidewaysScroll,
  waitForHydration,
} from '@pyre/e2e-utils';

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
