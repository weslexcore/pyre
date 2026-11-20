// Pyre Agent from any admin page: the dock (PyreAgentDock) in the corner
// opens the chat as a window on desktop and a full-screen modal on a phone.
// Closing it and changing pages must not lose the chat. The island is
// persisted across ClientRouter navigations, and a draft typed but never
// sent only lives in its React state, so seeing that draft again after a
// navigation proves it was the same chat and not a fresh one restored from
// storage.
//
// The agent is the mock Eve app (mock-server/eve.ts), scripted per question.

import { allowConsole } from '@pyre/e2e-utils';
import { eve, expect, test } from './pyre-agent-helpers';
import { ADMIN, STAFF } from './roles';
import { open, openAdminMenu } from './test';

test.describe.configure({ mode: 'parallel' });

test.describe('the Pyre Agent dock', () => {
  test.use({ storageState: ADMIN.storageState as string });

  test.describe('changing pages', () => {
    // A known issue apart from the dock: an island that hydrates onto a
    // cache entry warmed by the link hover (lib/client/cachedJson reads it
    // during the first render) does not match its server HTML, and React
    // re-renders it on the client. Page loads by URL never warm, so only a
    // spec that follows a link sees it.
    test.use({ consoleAllowlist: allowConsole('Hydration failed because the server rendered') });

    test('ask from any page; closing it or changing pages keeps the chat', async ({
      page,
      isMobile,
      marker,
    }) => {
      const answer = `Dock answer ${marker}`;
      await eve.script(marker, [{ answer }]);

      await open(page, '/admin/water');
      const launcher = page.getByRole('button', { name: 'Pyre Agent' });
      const dock = page.getByRole('dialog', { name: 'Pyre Agent' });
      await launcher.click();
      await expect(dock).toBeVisible();

      await dock.getByLabel('Your question').fill(`What is ${marker}?`);
      await dock.getByRole('button', { name: 'Send' }).click();
      await expect(dock.getByText(answer)).toBeVisible({ timeout: 30_000 });
      // The dock never writes the conversation into another page's URL.
      expect(new URL(page.url()).searchParams.has('c')).toBe(false);

      // Close and reopen: the same conversation, nothing reloaded.
      await dock.getByRole('button', { name: 'Close' }).click();
      await expect(dock).toBeHidden();
      await launcher.click();
      await expect(dock.getByText(answer)).toBeVisible();

      // An unsent draft, then a page change through the menu. The phone modal
      // covers the header, so it is closed first there.
      await dock.getByLabel('Your question').fill('an unsent draft');
      if (isMobile) await dock.getByRole('button', { name: 'Close' }).click();
      const menu = await openAdminMenu(page);
      await menu.locator('a[href="/admin/inventory"]').first().click();
      await expect(page).toHaveURL(/\/admin\/inventory/);

      if (isMobile) {
        await expect(dock).toBeHidden();
        await launcher.click();
      }
      // Desktop: the window stayed open beside the new page.
      await expect(dock).toBeVisible();
      await expect(dock.getByText(answer)).toBeVisible();
      await expect(dock.getByLabel('Your question')).toHaveValue('an unsent draft');

      // One question asked, one session at the agent.
      expect(await eve.knowledgeSessions(marker)).toHaveLength(1);
    });
  });

  test('on the Pyre Agent page the dock steps aside and the page has the chat', async ({
    page,
    marker,
  }) => {
    const answer = `Full page answer ${marker}`;
    await eve.script(marker, [{ answer }]);

    await open(page, '/admin/water');
    const launcher = page.getByRole('button', { name: 'Pyre Agent' });
    const dock = page.getByRole('dialog', { name: 'Pyre Agent' });
    await launcher.click();
    await dock.getByLabel('Your question').fill(`Tell me about ${marker}`);
    await dock.getByRole('button', { name: 'Send' }).click();
    await expect(dock.getByText(answer)).toBeVisible({ timeout: 30_000 });

    // A fresh load: the page finds the conversation in storage, not in the dock.
    await open(page, '/admin/ask');

    await expect(launcher).toHaveCount(0);
    await expect(dock).toBeHidden();
    // The page reopened the conversation the dock had open.
    await expect(page.getByRole('main').getByText(answer)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('without the Pyre Agent page', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('there is no dock', async ({ page }) => {
    await open(page, '/admin/water');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pyre Agent' })).toHaveCount(0);
  });
});
