// Every public page renders: 200, a title, a non-empty h1, no sideways
// scrolling, and nothing thrown or logged as an error in the browser (the error guard in ./test.ts fails the
// test otherwise). Then the links in the site chrome all resolve.

import { REFERRAL } from './mock-server/integrations-fixtures';
import { FIXTURE_EVENTS } from './mock-server/momence-fixtures';
import { clickAfterScroll, expect, expectNoSidewaysScroll, test } from './test';

const STATIC_PAGES = [
  '/',
  '/intro',
  '/unlimited',
  '/events',
  '/volunteer',
  '/shop',
  '/blog',
  '/bft',
  '/perks',
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

    await expectNoSidewaysScroll(page);
  });
}

// Server-rendered pages whose content comes from fixtures or stubs: the same
// checks, once their content is there.
const DYNAMIC_PAGES = [
  `/events/${FIXTURE_EVENTS.guided.id}-e2e-guided-sauna`,
  `/r/${REFERRAL.code}`,
  '/blog/history-of-sweat-bathing',
  '/account',
];

for (const path of DYNAMIC_PAGES) {
  test(`${path} renders`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status(), `status of ${path}`).toBe(200);
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('h1').first()).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
}

// Everything above runs under reduced motion (the shared config's default,
// which keeps CI's software-rendered WebGL from saturating the runner). That
// skips every animation, so here the pages whose content waits on one (the
// home page's intro and hero shader, scroll-in reveals, the schedule's
// transitions) load with motion on and must still end up showing it.
test.describe('with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('/ plays its intro and ends on the page', async ({ page }) => {
    await page.goto('/');
    // The wordmark starts hidden for the intro and is revealed by it. (Desktop
    // and phone each have their own hero; the other one is display: none.)
    await expect(page.locator('h1').filter({ visible: true }).first()).toHaveText(/\S/, {
      timeout: 15_000,
    });
    await expect(page.locator('#signup [data-signup-form]').first()).toBeAttached();
    await expectNoSidewaysScroll(page);
  });

  test('/events shows the schedule and opens a session', async ({ page }) => {
    await page.goto('/events');
    const session = page.getByRole('button').filter({ hasText: FIXTURE_EVENTS.guided.title });
    await expect(session).toBeVisible();
    await clickAfterScroll(session);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expectNoSidewaysScroll(page);
  });

  for (const path of ['/intro', '/shop', '/blog']) {
    test(`${path} renders`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `status of ${path}`).toBe(200);
      await expect(page.locator('h1').filter({ visible: true }).first()).toHaveText(/\S/, {
        timeout: 15_000,
      });
      await expectNoSidewaysScroll(page);
    });
  }
});

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
