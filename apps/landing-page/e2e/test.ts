// The landing page's `test`, built on @pyre/e2e-utils. Specs import from here,
// never from @playwright/test directly.

import type { Locator } from '@playwright/test';
import {
  createTest,
  mockServerClient,
  type RecordedRequest,
  stubTurnstile,
  waitForMinFillTime,
} from '@pyre/e2e-utils';
import promoPopups from '../src/lib/promoPopup';
import { MOCK_URL, TURNSTILE_TOKEN } from './env';

const base = createTest({
  // Every configured promo popup starts out "taken", so none of them opens
  // over the page mid-test. Read from the config so a new popup id doesn't
  // silently start covering pages. promo-popup.spec.ts turns the seeding off
  // (`test.use({ seedLocalStorage: {} })`) to test the popup itself.
  localStorage: Object.fromEntries(
    promoPopups.map((popup) => [`pyre-popup-taken-${popup.id}`, '1'])
  ),
  consoleAllowlist: [
    // Vite's dev client chatter.
    /\[vite\]/,
  ],
});

// The suite runs with a Turnstile site key (env.ts), so every form loads the
// widget. Each page gets the fake one, which solves with the token the mock
// siteverify accepts. A test can register its own stubTurnstile(page, token)
// afterwards to hand out a token the server rejects.
export const test = base.extend({
  page: async ({ page }, use) => {
    await stubTurnstile(page, TURNSTILE_TOKEN);
    await use(page);
  },
});

export { expect } from '@pyre/e2e-utils';

/**
 * Click `target` once the page has finished reacting to it being scrolled
 * into view. On a phone, scrolling past the first screen slides the sticky
 * offer bar (StickyOfferBar.astro) in over the bottom of the page on the next
 * frame, so a click made straight after the scroll can land on the bar
 * instead of the row it aimed at. Use it for targets that sit low on the
 * first screen, like the schedule's rows.
 */
export async function clickAfterScroll(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.page().evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    const bar = document.querySelector('[data-sticky-offer-bar]');
    await Promise.all((bar?.getAnimations() ?? []).map((animation) => animation.finished));
  });
  await target.click();
}

/** The site's forms drop submissions made under 3s after load (src/lib/signupForm.ts). */
export const waitForFormReady = (form: Locator) => waitForMinFillTime(form, 3_100);

export { expectNoSidewaysScroll } from '@pyre/e2e-utils';

const mock = mockServerClient(MOCK_URL);

/**
 * Requests the app's server made to the mock upstreams at `path` (e.g.
 * '/integrations/api/partner/request'), optionally narrowed by a predicate on
 * the JSON body. The log is shared by every worker, so narrow by something
 * unique to the test, like a uniqueEmail.
 */
export async function upstreamRequests(
  path: string,
  where: (body: Record<string, unknown>) => boolean = () => true
): Promise<RecordedRequest[]> {
  return (await mock.requests()).filter(
    (request) => request.path === path && where((request.body ?? {}) as Record<string, unknown>)
  );
}
