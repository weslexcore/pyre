// Shared Playwright config for the per-app E2E suites.
//
// Every app's playwright.config.ts is a call to `definePyreConfig`, so retries,
// reporters, tracing and the device matrix are decided once, here. An app only
// says which port it serves on and which servers have to be running first.

import { defineConfig, devices, type PlaywrightTestConfig, type Project } from '@playwright/test';

const CI = Boolean(process.env.CI);

/** Tag a test with this to also run it in the `mobile` project. */
export const MOBILE_TAG = '@mobile';

/**
 * Tag a test with this to run it in the `mobile` project only: behaviour that
 * doesn't exist at desktop widths, like the hamburger menu.
 */
export const MOBILE_ONLY_TAG = '@mobile-only';

type WebServerEntry = Extract<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>[number];

export interface PyreConfigOptions {
  /** Port the app under test listens on; `baseURL` is http://localhost:<port>. */
  port: number;
  /**
   * Servers to start before the suite, in order: mock upstreams first, then
   * the app. Shared defaults (reuse locally, piped output, a generous startup
   * timeout) are applied to each.
   */
  webServers: WebServerEntry[];
  /** Directory holding the specs. Defaults to `./e2e`. */
  testDir?: string;
  /** Replaces the default `chromium` + `mobile` projects. */
  projects?: Project[];
  /** Escape hatch for anything else; merged over the shared defaults. */
  overrides?: PlaywrightTestConfig;
}

/**
 * Desktop Chromium runs everything except `@mobile-only` tests. The mobile
 * project (Pixel 7, also Chromium, so CI only installs one browser) runs only
 * tests tagged `@mobile` or `@mobile-only`: the responsive behaviour worth
 * checking, not the whole suite twice.
 */
export function defaultProjects(): Project[] {
  return [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: new RegExp(MOBILE_ONLY_TAG),
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // Matches both tags: `@mobile` is a prefix of `@mobile-only`.
      grep: new RegExp(MOBILE_TAG),
    },
  ];
}

export function definePyreConfig(options: PyreConfigOptions): PlaywrightTestConfig {
  const baseURL = `http://localhost:${options.port}`;

  return defineConfig({
    testDir: options.testDir ?? './e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    forbidOnly: CI,
    retries: CI ? 2 : 0,
    // Dev servers compile on first request; two workers keep CI runners from
    // timing out while still parallelising.
    workers: CI ? 2 : undefined,
    reporter: CI
      ? [['github'], ['html', { open: 'never' }]]
      : [['list'], ['html', { open: 'never' }]],
    expect: { timeout: 10_000 },
    use: {
      baseURL,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
    },
    projects: options.projects ?? defaultProjects(),
    webServer: options.webServers.map((server) => ({
      reuseExistingServer: !CI,
      // Dev-server request logs drown the report; startup errors still surface
      // on stderr. Set E2E_SERVER_LOGS=1 to see everything.
      stdout: process.env.E2E_SERVER_LOGS ? 'pipe' : 'ignore',
      stderr: 'pipe',
      timeout: 180_000,
      ...server,
    })),
    ...options.overrides,
  });
}
