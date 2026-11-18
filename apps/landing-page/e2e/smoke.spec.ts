// Every public page renders: 200, a title, a visible h1, and nothing thrown or
// logged as an error in the browser (the error guard in ./test.ts fails the
// test otherwise). Then the links in the site chrome all resolve.

import { expect, test } from './test';

const STATIC_PAGES = [
  '/',
  '/intro',
  '/unlimited',
  '/events',
  '/volunteer',
  '/shop',
  '/blog',
  '/bft',
  '/embody',
  '/humble-haven',
  '/hi',
  '/privacy-policy',
  '/terms-of-service',
  '/cookie-policy',
  '/health-and-safety',
];

for (const path of STATIC_PAGES) {
  test(`${path} renders`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status(), `status of ${path}`).toBe(200);
    await expect(page).toHaveTitle(/\S/);
    // Every page names itself with an h1. (The home page's is the logo
    // wordmark, which starts hidden for its intro animation.)
    await expect(page.locator('h1').first()).toHaveText(/\S/);
  });
}

test('links in the header and footer resolve', async ({ page, request }) => {
  await page.goto('/');

  const hrefs = await page
    .locator('header a[href], footer a[href]')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));

  const internal = [
    ...new Set(
      hrefs
        .map((href) => new URL(href))
        .filter((url) => url.origin === new URL(page.url()).origin)
        // API routes (login, …) need real credentials; they're covered elsewhere.
        .filter((url) => !url.pathname.startsWith('/api/'))
        .map((url) => url.pathname)
    ),
  ];
  expect(internal.length).toBeGreaterThan(3);

  for (const path of internal) {
    const response = await request.get(path);
    expect(response.status(), `GET ${path}`).toBeLessThan(400);
  }
});
