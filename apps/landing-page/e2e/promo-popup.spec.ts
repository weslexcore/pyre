// The promo popup is pre-dismissed for every other spec (the suite's storage
// seeding in ./test.ts). Here the seeding is off, so it starts fresh.
//
// Time is controlled with page.clock: the popup's idle-time setup and its
// delay are timers, so the test holds the clock still and moves it by hand,
// instead of sleeping, and can say exactly when the popup may and may not be
// open however slowly the page loads.

import type { Page } from '@playwright/test';
import promoPopups from '../src/lib/promoPopup';
import { expect, test } from './test';

test.use({ seedLocalStorage: {} });

// The popup the page picks: the first enabled one whose date window is live.
const now = new Date();
const popup = promoPopups.find(
  (p) =>
    p.enabled &&
    (!p.starts || now >= new Date(p.starts)) &&
    (!p.expires || now <= new Date(p.expires))
);
const delayMs = popup?.delayMs ?? 1_500;
// The popup sets itself up once the browser is idle: requestIdleCallback
// with a 2s timeout, or a 1.5s timer where there's none (WebKit).
const SETUP_MS = 2_000;

/** Load the page and let it finish loading, with the clock still held. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('load');
}

test('appears after its delay, folds into a tab when closed, and reopens from it after a reload', async ({
  page,
}) => {
  test.skip(!popup, 'No popup is live');
  if (!popup?.promoText) return;

  // Installed, the fake clock still runs in real time; pausing it means a
  // slow page load can't use up the delay before the first check.
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 1_000);
  // Landing pages like /intro hide promos; the blog shows them.
  await open(page, '/blog');
  const container = page.locator('[data-component="promo-popup"]');
  const headline = container.getByText(popup.headline);
  const tab = page.getByRole('button', { name: `Reopen: ${popup.promoText}` });

  // However early setup ran, the delay hasn't passed yet.
  await page.clock.runFor(delayMs - 1);
  await expect(headline).toBeHidden();
  // Setup has certainly run and the delay has passed.
  await page.clock.runFor(SETUP_MS + 1);
  await expect(headline).toBeVisible();

  await container.getByRole('button', { name: 'Close popup' }).click();
  await page.clock.runFor(400); // the close animation
  await expect(headline).toBeHidden();
  await expect(tab).toBeVisible();

  // After a reload the popup stays closed, but the tab comes back...
  await page.reload();
  await page.waitForLoadState('load');
  await page.clock.runFor(SETUP_MS + delayMs + 1);
  await expect(tab).toBeVisible();
  await expect(headline).toBeHidden();

  // ...and brings the popup back.
  await tab.click();
  await page.clock.runFor(400); // the tab's exit animation
  await expect(headline).toBeVisible();
  await expect(container.getByRole('button', { name: 'Close popup' })).toBeVisible();
});
