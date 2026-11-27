// Layout assertions shared by every suite.

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Nothing pushes the page wider than the screen. On a phone that shows up as
 * sideways scrolling, which reads as a broken page. Call it once the content
 * under test has rendered: client-hydrated content isn't there straight after
 * goto.
 */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > width + 1;
      })
      // Report the outermost offender, not every descendant of it.
      .filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)))
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].slice(0, 3).join('.')}`
      );
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders };
  });
  expect(
    overflow.scrollWidth,
    `${new URL(page.url()).pathname} scrolls sideways; widest elements: ${overflow.offenders.join(', ')}`
  ).toBeLessThanOrEqual(overflow.width + 1);
}

/**
 * Wait until every Astro island on the page has hydrated. Astro removes the
 * `ssr` attribute from an <astro-island> once its component has mounted;
 * typing into a React form before that is lost when React takes over the
 * input, leaving its state (and so its submit button) empty.
 */
export async function waitForHydration(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0, null, {
    timeout,
  });
}

/**
 * Click a link and wait until the page it leads to has hydrated. Under
 * Astro's <ClientRouter /> (the integrations dashboard) a link click swaps the
 * new page's server-rendered HTML in without a page load: its URL and text
 * show at once, but its islands mount a moment later, and a click or typing
 * before then is lost. waitForHydration alone can pass on the old page, so
 * this first waits for the swap to finish (astro:page-load) or for a new
 * document (a full page load, where the marker below is gone).
 */
export async function clickAndHydrate(target: Locator, timeout = 15_000): Promise<void> {
  const page = target.page();
  await page.evaluate(() => {
    const marked = window as Window & { __e2eSwapped?: boolean };
    marked.__e2eSwapped = false;
    document.addEventListener(
      'astro:page-load',
      () => {
        marked.__e2eSwapped = true;
      },
      { once: true }
    );
  });
  await target.click();
  await expect
    .poll(
      () =>
        page
          .evaluate(() => (window as Window & { __e2eSwapped?: boolean }).__e2eSwapped !== false)
          // The old document's context goes away mid-navigation; try again.
          .catch(() => false),
      { timeout, message: 'the link led to a new page' }
    )
    .toBe(true);
  await waitForHydration(page, timeout);
}
