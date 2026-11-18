// The landing page's `test`, built on @pyre/e2e-utils. Specs import from here,
// never from @playwright/test directly.

import type { Locator } from '@playwright/test';
import { createTest, waitForMinFillTime } from '@pyre/e2e-utils';
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
