// Site chrome: the booking CTA and the mobile menu.

import { MOBILE_TAG } from '@pyre/e2e-utils';
import { expect, test } from './test';

test('the nav Book button goes to the schedule', { tag: MOBILE_TAG }, async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const placement = isMobile ? 'nav_book_mobile' : 'nav_book';
  const book = page.locator(`[data-track-placement="${placement}"]`);
  await expect(book).toBeVisible();
  await expect(book).toHaveAttribute('href', /\/events$/);
});

test('the mobile menu opens and closes', { tag: MOBILE_TAG }, async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The menu button only exists at mobile widths');
  await page.goto('/');

  const button = page.locator('#mobile-menu-button');
  const menu = page.locator('#mobile-menu');

  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: /blog/i }).first()).toBeVisible();

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});
