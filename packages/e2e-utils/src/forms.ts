// Helpers for the site's anti-bot form conventions.

import { expect, type Locator } from '@playwright/test';

/**
 * Wait until a form has been open for `ms`. The forms stamp a hidden
 * `form_timestamp` field on load and silently drop anything submitted sooner
 * than a few seconds later, so a test that submits immediately sees nothing
 * happen. Polls the stamped value rather than sleeping a fixed time.
 */
export async function waitForMinFillTime(
  form: Locator,
  ms = 3_000,
  field = 'form_timestamp'
): Promise<void> {
  const stamp = form.locator(`input[name="${field}"]`).first();
  await expect
    .poll(
      async () => {
        const startedAt = Number(await stamp.inputValue());
        return startedAt > 0 && Date.now() - startedAt >= ms;
      },
      { timeout: ms + 10_000, intervals: [250] }
    )
    .toBe(true);
}

/** Fill inputs inside `form` by their `name` attribute. */
export async function fillByName(form: Locator, fields: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(fields)) {
    await form.locator(`[name="${name}"]`).fill(value);
  }
}
