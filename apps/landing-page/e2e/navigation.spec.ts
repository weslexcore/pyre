// Site chrome: the booking CTA and the mobile menu.

import type { Page } from '@playwright/test';
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
//
// The closed menu is `max-h-0 opacity-0`, which Playwright still counts as
// visible, so open/closed is checked through the header's data-menu-open and
// whether the links are actually on screen (toBeInViewport accounts for the
// overflow clip).
test.describe('mobile menu', { tag: MOBILE_ONLY_TAG }, () => {
  const header = (page: Page) => page.locator('header[data-component="navbar"]');
  const menu = (page: Page) => page.getByRole('navigation', { name: 'Mobile navigation' });
  const blogLink = (page: Page) => menu(page).getByRole('link', { name: /blog/i }).first();

  async function expectOpen(page: Page, open: boolean) {
    await expect(page.locator('#mobile-menu-button')).toHaveAttribute(
      'aria-expanded',
      String(open)
    );
    await expect(header(page)).toHaveAttribute('data-menu-open', String(open));
    if (open) await expect(blogLink(page)).toBeInViewport();
    else await expect(blogLink(page)).not.toBeInViewport();
  }

  test('opens and closes', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('#mobile-menu-button');

    await expectOpen(page, false);
    await button.click();
    await expectOpen(page, true);

    await button.click();
    await expectOpen(page, false);
  });

  test('a link navigates and closes the menu', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-menu-button').click();
    await expectOpen(page, true);

    await blogLink(page).click();

    await expect(page).toHaveURL(/\/blog$/);
    await expectOpen(page, false);
  });

  test('the Book button inside it goes to the schedule', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-menu-button').click();

    const book = page.locator('[data-track-placement="mobile_nav_book"]');
    await expect(book).toBeInViewport();
    await book.click();
    await expect(page).toHaveURL(/\/events$/);
  });

  test('tapping outside closes it', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-menu-button').click();
    await expectOpen(page, true);

    // Tap a point below the menu that isn't a link, button or form control, so
    // the tap can't close the menu by navigating away.
    const point = await page.evaluate(() => {
      const menuBottom =
        document.getElementById('mobile-menu')?.getBoundingClientRect().bottom ?? 0;
      const x = window.innerWidth / 2;
      for (let y = window.innerHeight - 10; y > menuBottom + 10; y -= 10) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('a, button, input, select, textarea, label, [role="button"]')) {
          return { x, y };
        }
      }
      return null;
    });
    expect(point, 'no inert spot below the open menu to tap').not.toBeNull();
    const url = page.url();
    await page.mouse.click(point!.x, point!.y);

    await expectOpen(page, false);
    expect(page.url()).toBe(url);
  });
});
