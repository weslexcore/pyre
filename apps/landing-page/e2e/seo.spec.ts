// The machine-readable surfaces crawlers and LLMs depend on.

import { allowConsole } from '@pyre/e2e-utils';
import { FIXTURE_EVENTS } from './mock-server/momence-fixtures';
import { expect, test } from './test';

test('robots.txt points at the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/Sitemap:\s*\S+/i);
});

test('llms.txt is served as text', async ({ request }) => {
  const response = await request.get('/llms.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/');
  expect((await response.text()).length).toBeGreaterThan(100);
});

test('the events sitemap lists upcoming sessions and nothing the schedule hides', async ({
  request,
}) => {
  const response = await request.get('/events-sitemap.xml');
  expect(response.status()).toBe(200);
  const xml = await response.text();

  expect(xml).toContain(`/events/${FIXTURE_EVENTS.guided.id}-e2e-guided-sauna`);
  for (const hidden of [FIXTURE_EVENTS.volunteer, FIXTURE_EVENTS.cancelled, FIXTURE_EVENTS.past]) {
    expect(xml).not.toContain(`/events/${hidden.id}`);
  }
});

for (const path of ['/', '/intro', '/events']) {
  test(`${path} has a description, canonical URL and social preview`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{40,}/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`${path === '/' ? '/?' : path}$`)
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /\S/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https?:/);
  });
}

test.describe('not found', () => {
  // Chrome logs the document's own 404 as a console error.
  test.use({ consoleAllowlist: allowConsole(/status of 404/) });

  test('an unknown route gets the 404 page', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1').first()).toBeVisible();
  });
});
