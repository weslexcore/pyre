// Site chrome: the booking CTA and the mobile menu.

import { MOBILE_ONLY_TAG } from '@pyre/e2e-utils';
import { expect, test } from './test';

test('the nav Book button goes to the schedule', async ({ page, isMobile }) => {
  await page.goto('/');
  const placement = isMobile ? 'nav_book_mobile' : 'nav_book';
  const book = page.locator(`[data-track-placement="${placement}"]`);
  await expect(book).toBeVisible();
  await expect(book).toHaveAttribute('href', /\/events$/);

  await book.click();
  await expect(page).toHaveURL(/\/events$/);
});

// The menu button only exists at phone widths, so these run on the phone
// projects alone.
test.describe('mobile menu', { tag: MOBILE_ONLY_TAG }, () => {
  test('opens and closes', async ({ page }) => {
    await page.goto('/');

    const button = page.locator('#mobile-menu-button');
    const menu = page.getByRole('navigation', { name: 'Mobile navigation' });

    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: /blog/i }).first()).toBeVisible();

    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('a link navigates and closes the menu', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-menu-button').click();

    const menu = page.getByRole('navigation', { name: 'Mobile navigation' });
    await menu.getByRole('link', { name: /blog/i }).first().click();

    await expect(page).toHaveURL(/\/blog$/);
    await expect(page.locator('#mobile-menu-button')).toHaveAttribute('aria-expanded', 'false');
  });

  test('the Book button inside it goes to the schedule', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-menu-button').click();

    const book = page.locator('[data-track-placement="mobile_nav_book"]');
    await expect(book).toBeVisible();
    await book.click();
    await expect(page).toHaveURL(/\/events$/);
  });

  test('tapping outside closes it', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('#mobile-menu-button');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    const viewport = page.viewportSize();
    await page.mouse.click((viewport?.width ?? 390) / 2, (viewport?.height ?? 800) - 40);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
