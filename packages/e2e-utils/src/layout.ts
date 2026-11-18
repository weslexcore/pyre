// Layout assertions shared by every suite.

import { expect, type Page } from '@playwright/test';

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
