// The base `test` every app's specs import (via the app's own e2e/test.ts).
//
// It adds three things to Playwright's built-in fixtures:
//   1. Storage seeding: localStorage values written before any page script
//      runs, e.g. to pre-dismiss a promo popup that would otherwise cover the
//      page in every test.
//   2. External blocking: browser requests to hosts outside the allowlist are
//      aborted, so a test can never reach a real third party by accident. A
//      test that needs one stubs it with page.route (see routes.ts); routes
//      registered later take precedence over this one.
//   3. A browser-error guard: any uncaught page error or console.error fails
//      the test, unless it matches the allowlist. Add to it per file or
//      describe block with `test.use({ consoleAllowlist: allowConsole(...) })`.

import { test as base, expect } from '@playwright/test';

export type ConsolePattern = string | RegExp;

export interface CreateTestOptions {
  /** localStorage entries written before every document loads. */
  localStorage?: Record<string, string>;
  /**
   * Hosts the browser may reach besides the app itself (localhost and
   * 127.0.0.1 are always allowed). Defaults to none.
   */
  allowHosts?: string[];
  /** Console errors / page errors to ignore across the whole suite. */
  consoleAllowlist?: ConsolePattern[];
}

/** Chrome logs this when blockExternal aborts a request; never a real failure. */
export const BLOCKED_REQUEST_PATTERN = /net::ERR_BLOCKED_BY_CLIENT/;

const ALWAYS_ALLOWED_HOSTS = ['localhost', '127.0.0.1'];

/**
 * Value for `test.use({ consoleAllowlist })`. Always go through this: a bare
 * array like `[/a/, /b/]` is read by Playwright as a `[value, options]` fixture
 * tuple (a RegExp looks like an options object), silently dropping patterns.
 */
export function allowConsole(...patterns: ConsolePattern[]): [ConsolePattern[], { scope: 'test' }] {
  return [patterns, { scope: 'test' }];
}

function matches(text: string, patterns: ConsolePattern[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
  );
}

interface PyreFixtures {
  /** Per-test or per-file additions to the suite's console allowlist. */
  consoleAllowlist: ConsolePattern[];
  /** Errors the guard has collected so far; a test can inspect it. */
  browserErrors: string[];
  _browserErrorGuard: void;
}

export function createTest(options: CreateTestOptions = {}) {
  const allowHosts = new Set([...ALWAYS_ALLOWED_HOSTS, ...(options.allowHosts ?? [])]);
  const suiteAllowlist = [BLOCKED_REQUEST_PATTERN, ...(options.consoleAllowlist ?? [])];

  return base.extend<PyreFixtures>({
    consoleAllowlist: [[], { option: true }],

    page: async ({ page }, use) => {
      if (options.localStorage && Object.keys(options.localStorage).length > 0) {
        await page.addInitScript((entries) => {
          for (const [key, value] of Object.entries(entries)) {
            try {
              window.localStorage.setItem(key, value);
            } catch {
              // Opaque origins (about:blank) have no storage; nothing to seed.
            }
          }
        }, options.localStorage);
      }

      await page.route(
        (url) => url.protocol.startsWith('http') && !allowHosts.has(url.hostname),
        (route) => route.abort('blockedbyclient')
      );

      await use(page);
    },

    browserErrors: async ({ page, consoleAllowlist }, use) => {
      const errors: string[] = [];
      const allowlist = [...suiteAllowlist, ...consoleAllowlist];

      page.on('pageerror', (error) => {
        const text = `pageerror: ${error.message}`;
        if (!matches(text, allowlist)) errors.push(text);
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const location = message.location();
        const text = `console.error: ${message.text()}${location.url ? ` (${location.url})` : ''}`;
        if (!matches(text, allowlist)) errors.push(text);
      });

      await use(errors);
    },

    _browserErrorGuard: [
      async ({ browserErrors }, use, testInfo) => {
        await use();
        // Only add a failure to a test that otherwise passed; a test that
        // already failed keeps its own, more useful, error.
        if (testInfo.status === testInfo.expectedStatus && testInfo.expectedStatus === 'passed') {
          expect(browserErrors, 'Unexpected errors in the browser console').toEqual([]);
        }
      },
      { auto: true },
    ],
  });
}

export { expect };
