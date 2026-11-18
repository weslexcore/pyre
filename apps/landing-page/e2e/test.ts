// The landing page's `test`, built on @pyre/e2e-utils. Specs import from here,
// never from @playwright/test directly.

import type { Locator, Page } from '@playwright/test';
import { createTest, expect, waitForMinFillTime } from '@pyre/e2e-utils';
import promoPopups from '../src/lib/promoPopup';

export const test = createTest({
  // Every configured promo popup starts out "taken", so none of them opens
  // over the page mid-test. Read from the config so a new popup id doesn't
  // silently start covering pages. promo-popup.spec.ts clears this to test the
  // popup itself.
  localStorage: Object.fromEntries(
    promoPopups.map((popup) => [`pyre-popup-taken-${popup.id}`, '1'])
  ),
  consoleAllowlist: [
    // Vite's dev client chatter.
    /\[vite\]/,
  ],
});

export { expect } from '@pyre/e2e-utils';

/** The site's forms drop submissions made under 3s after load (src/lib/signupForm.ts). */
export const waitForFormReady = (form: Locator) => waitForMinFillTime(form, 3_100);

/**
 * Nothing pushes the page wider than the screen. On a phone that shows up as
 * sideways scrolling, which reads as a broken page. Call it once the content
 * under test has rendered: client-hydrated content (the schedule, shop stock)
 * isn't there straight after goto.
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
