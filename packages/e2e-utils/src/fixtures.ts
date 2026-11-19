// The base `test` every app's specs import (via the app's own e2e/test.ts).
//
// It adds three things to Playwright's built-in fixtures, to `page` and to
// every page `newPage()` opens (another person signed in during the test):
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

import { type BrowserContextOptions, test as base, expect, type Page } from '@playwright/test';

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

/**
 * WebKit reports a same-origin load that a navigation cancelled (an image
 * still downloading when a test taps a link) as an "access control" error.
 * Matched only for localhost URLs, so a real cross-origin CORS failure still
 * fails the test.
 */
export const WEBKIT_CANCELLED_LOAD_PATTERN = /localhost:\d+\/\S* due to access control checks/;

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
  /**
   * A page in a browser context of its own (another person signed in beside
   * the test's own `page`), on the same device as the project, with the same
   * external blocking and browser-error guard as `page`. Pass the context
   * options that differ, usually `storageState`. Closed when the test ends.
   */
  newPage: (options?: BrowserContextOptions) => Promise<Page>;
}

export function createTest(options: CreateTestOptions = {}) {
  const allowHosts = new Set([...ALWAYS_ALLOWED_HOSTS, ...(options.allowHosts ?? [])]);
  const suiteAllowlist = [
    BLOCKED_REQUEST_PATTERN,
    WEBKIT_CANCELLED_LOAD_PATTERN,
    ...(options.consoleAllowlist ?? []),
  ];

  /** Storage seeding and external blocking, for every page a test opens. */
  const preparePage = async (page: Page) => {
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
  };

  /** Collect a page's uncaught errors and console.errors into `errors`. */
  const watchErrors = (page: Page, allowlist: ConsolePattern[], errors: string[], label = '') => {
    page.on('pageerror', (error) => {
      const text = `${label}pageerror: ${error.message}`;
      if (!matches(text, allowlist)) errors.push(text);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const location = message.location();
      const text = `${label}console.error: ${message.text()}${location.url ? ` (${location.url})` : ''}`;
      if (!matches(text, allowlist)) errors.push(text);
    });
  };

  return base.extend<PyreFixtures>({
    consoleAllowlist: [[], { option: true }],

    page: async ({ page }, use) => {
      await preparePage(page);
      await use(page);
    },

    browserErrors: async ({ page, consoleAllowlist }, use) => {
      const errors: string[] = [];
      watchErrors(page, [...suiteAllowlist, ...consoleAllowlist], errors);
      await use(errors);
    },

    newPage: async (
      {
        browser,
        browserErrors,
        consoleAllowlist,
        baseURL,
        viewport,
        userAgent,
        isMobile,
        hasTouch,
        deviceScaleFactor,
        locale,
        timezoneId,
        reducedMotion,
      },
      use
    ) => {
      const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
      await use(async (contextOptions = {}) => {
        const context = await browser.newContext({
          baseURL,
          viewport,
          userAgent,
          isMobile,
          hasTouch,
          deviceScaleFactor,
          locale,
          timezoneId,
          reducedMotion,
          ...contextOptions,
        });
        contexts.push(context);
        const page = await context.newPage();
        await preparePage(page);
        // Errors land in the test's own list, so the guard below covers them.
        watchErrors(
          page,
          [...suiteAllowlist, ...consoleAllowlist],
          browserErrors,
          `[context ${contexts.length + 1}] `
        );
        return page;
      });
      await Promise.all(contexts.map((context) => context.close()));
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
