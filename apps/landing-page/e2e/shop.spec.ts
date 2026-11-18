// Stock and prices on the static shop page are hydrated from /api/shop-stock,
// which reads the mock Momence /Products.

import { FIXTURE_PRODUCTS as P } from './mock-server/momence-fixtures';
import { expect, test } from './test';

test('prices and stock come from Momence', async ({ page }) => {
  await page.goto('/shop');

  const card = (id: number) => page.locator(`[data-momence-id="${id}"]`);

  await expect(card(P.tote.id).locator('[data-product-price]')).toHaveText(`$${P.tote.price}`);
  await expect(card(P.tote.id)).toHaveAttribute('href', /momence\.com\/g\/439299/);

  // Variants render in size order, sold-out sizes struck through.
  const sizes = card(P.shirt.id).locator('[data-product-variants] span');
  await expect(sizes).toHaveText(['S', 'M', 'L']);
  await expect(sizes.nth(2)).toHaveClass(/line-through/);

  // Out of stock: not purchasable.
  await expect(card(P.sticker.id)).toHaveAttribute('aria-disabled', 'true');
  await expect(card(P.sticker.id)).not.toHaveAttribute('href', /.+/);
  await expect(card(P.sticker.id).getByText('Sold Out')).toBeVisible();
});
