// The promo popup is pre-dismissed for every other spec (see ./test.ts). Here
// it starts fresh.

import promoPopups from '../src/lib/promoPopup';
import { expect, test } from './test';

const popup = promoPopups.find((p) => p.enabled);

test('appears after its delay and stays dismissed', async ({ page }) => {
  test.skip(!popup, 'No popup is enabled');
  if (!popup) return;

  // Undo the suite-wide seeding for this test's pages.
  await page.addInitScript((id) => localStorage.removeItem(`pyre-popup-taken-${id}`), popup.id);

  // Landing pages like /intro hide promos; the blog shows them.
  await page.goto('/blog');
  const container = page.locator('[data-component="promo-popup"]');
  const headline = container.getByText(popup.headline);
  await expect(headline).toBeVisible({ timeout: 10_000 });

  await container.getByRole('button', { name: 'Close popup' }).click();
  await expect(headline).toBeHidden();
  // Dismissed, it folds into a tab that can bring it back.
  await expect(page.getByRole('button', { name: `Reopen: ${popup.promoText}` })).toBeVisible();

  await page.reload();
  await page.waitForTimeout((popup.delayMs ?? 1_500) + 1_000);
  await expect(headline).toBeHidden();
});
