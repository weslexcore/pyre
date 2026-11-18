import { allowConsole } from '@pyre/e2e-utils';
import { expect, test } from './test';

const visibleCards = (page: import('@playwright/test').Page) =>
  page.locator('.blog-post-card').filter({ visible: true });

test('search narrows the posts and reports the count', async ({ page }) => {
  await page.goto('/blog');
  await expect(visibleCards(page).first()).toBeVisible();

  await page.locator('#blog-search').fill('global history of sweat');
  await expect(visibleCards(page)).toHaveCount(1);
  await expect(visibleCards(page)).toHaveAttribute('data-slug', 'history-of-sweat-bathing');
  await expect(page.locator('#results-count')).toHaveText('1');
});

test('a search with no matches shows the empty state', async ({ page }) => {
  await page.goto('/blog');
  await page.locator('#blog-search').fill('zzzz-no-such-post');
  await expect(visibleCards(page)).toHaveCount(0);
  await expect(page.locator('#results-count')).toHaveText('0');
});

test('tag filters show only posts with that tag, and clear', async ({ page }) => {
  await page.goto('/blog');
  const before = await visibleCards(page).count();

  await page.locator('#toggle-tag-filters').click();
  await page.locator('#tag-filters-content [data-tag="history"]').click();

  await expect(visibleCards(page).first()).toBeVisible();
  for (const tags of await visibleCards(page).evaluateAll((cards) =>
    cards.map((card) => JSON.parse(card.getAttribute('data-tags') ?? '[]') as string[])
  )) {
    expect(tags).toContain('history');
  }

  await page.locator('#clear-all-filters').click();
  await expect(visibleCards(page)).toHaveCount(before);
});

test('a post renders', async ({ page }) => {
  await page.goto('/blog');
  const first = visibleCards(page).first();
  const slug = await first.getAttribute('data-slug');
  await first.getByRole('link').first().click();

  await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`));
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('article, main').first()).toContainText(/\w{20,}|\w+ \w+ \w+/);
});

test.describe('not found', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 404/) });

  test('an unknown post goes to the 404 page', async ({ page }) => {
    await page.goto('/blog/no-such-post');
    await expect(page).toHaveURL(/\/404$/);
  });
});
