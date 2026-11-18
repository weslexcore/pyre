// Shared Playwright config for the per-app E2E suites.
//
// Every app's playwright.config.ts is a call to `definePyreConfig`, so retries,
// reporters, tracing and the device matrix are decided once, here. An app only
// says which port it serves on and which servers have to be running first.

import { defineConfig, devices, type PlaywrightTestConfig, type Project } from '@playwright/test';

const CI = Boolean(process.env.CI);

/**
 * Tag a test with this to run it on the phone projects only: behaviour that
 * doesn't exist at desktop widths, like the hamburger menu. Every untagged
 * test runs on all three projects.
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
  /** Replaces the default desktop + phone projects (see defaultProjects). */
  projects?: Project[];
  /** Escape hatch for anything else; merged over the shared defaults. */
  overrides?: PlaywrightTestConfig;
}

/**
 * Every test runs on desktop and on two phones, because most customers book
 * from a phone:
 *   - chromium       Desktop Chrome
 *   - mobile-chrome  Pixel 7 (Android Chrome)
 *   - mobile-safari  iPhone 15 on WebKit, the engine every iOS browser uses.
 *                    Chromium's phone emulation doesn't catch Safari-only bugs.
 * `@mobile-only` tests skip the desktop project.
 */
export function defaultProjects(): Project[] {
  return [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: new RegExp(MOBILE_ONLY_TAG),
    },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
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
