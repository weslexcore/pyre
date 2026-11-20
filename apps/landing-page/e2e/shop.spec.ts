// Stock and prices on the static shop page are hydrated from /api/shop-stock,
// which reads the mock Momence /Products.

import type { Page } from '@playwright/test';
import { allowConsole } from '@pyre/e2e-utils';
import { FIXTURE_PRODUCTS as P } from './mock-server/momence-fixtures';
import { expect, test } from './test';

const card = (page: Page, id: number) => page.locator(`[data-momence-id="${id}"]`);

test('prices and stock come from Momence', async ({ page }) => {
  await page.goto('/shop');

  await expect(card(page, P.tote.id).locator('[data-product-price]')).toHaveText(
    `$${P.tote.price}`
  );
  await expect(card(page, P.tote.id)).toHaveAttribute('href', /momence\.com\/g\/439299/);

  // Variants render in size order, sold-out sizes struck through.
  const sizes = card(page, P.shirt.id).locator('[data-product-variants] span');
  await expect(sizes).toHaveText(['S', 'M', 'L']);
  await expect(sizes.nth(2)).toHaveClass(/line-through/);

  // Out of stock: not purchasable.
  await expect(card(page, P.sticker.id)).toHaveAttribute('aria-disabled', 'true');
  await expect(card(page, P.sticker.id)).not.toHaveAttribute('href', /.+/);
  await expect(card(page, P.sticker.id).getByText('Sold Out')).toBeVisible();
});

// Without live stock the page keeps its built-in catalogue and lets every
// product be bought, rather than leaving cards dead or guessing what's sold
// out: Momence's own checkout has the final say.
for (const failure of ['a server error', 'a network failure'] as const) {
  test.describe(`when stock can't be loaded (${failure})`, () => {
    test.use({ consoleAllowlist: allowConsole(/status of 500/, /Failed to load resource/) });

    test('every product stays purchasable at its listed price', async ({ page }) => {
      let asked = false;
      await page.route('**/api/shop-stock', (route) => {
        asked = true;
        return failure === 'a server error'
          ? route.fulfill({ status: 500, json: {} })
          : route.abort('connectionfailed');
      });
      await page.goto('/shop');

      for (const product of Object.values(P)) {
        const item = card(page, product.id);
        // Clickable again once the stock check has given up.
        await expect(item).not.toHaveClass(/pointer-events-none/);
        await expect(item).toHaveAttribute(
          'href',
          (await item.getAttribute('data-purchase-url')) ?? ''
        );
        await expect(item).not.toHaveAttribute('aria-disabled', 'true');
        await expect(item.locator('[data-product-price]')).toHaveText(/^\$\d+/);
      }
      // Nothing is marked sold out on a guess.
      await expect(page.getByText('Sold Out')).toHaveCount(0);
      expect(asked).toBe(true);
    });
  });
}
