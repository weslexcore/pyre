# @pyre/e2e-utils

Shared Playwright setup for the per-app E2E suites. Each app owns its specs in
`apps/<app>/e2e/`; this package holds what they have in common. The landing
page (`apps/landing-page/e2e/`) is the reference suite.

## What's here

| Export | From | Purpose |
|---|---|---|
| `definePyreConfig` | `@pyre/e2e-utils` | Playwright config with shared defaults: retries and `forbidOnly` in CI, trace on first retry, webServer defaults, and three projects. Every test runs on `chromium` (Desktop Chrome), `mobile-chrome` (Pixel 7) and `mobile-safari` (iPhone 15 on WebKit, the engine behind every iOS browser) |
| `MOBILE_ONLY_TAG` | `@pyre/e2e-utils` | Tag a test or `describe` with `{ tag: MOBILE_ONLY_TAG }` to run it on the phone projects only, for behaviour that doesn't exist on desktop (the hamburger menu). Where desktop and phone differ inside one test, branch on the `isMobile` fixture |
| `createTest` | `@pyre/e2e-utils` | The base `test`. It seeds localStorage before page scripts run, blocks browser requests to third-party hosts, and fails a test on any page error or `console.error`. Known noise is allowed by default: Chrome's blocked-request message, and WebKit's report of same-origin loads cancelled by a navigation |
| `allowConsole` | `@pyre/e2e-utils` | `test.use({ consoleAllowlist: allowConsole(/status of 404/) })` for expected errors. Use it rather than a bare array, which Playwright reads as a fixture tuple |
| `stubJson`, `stubMailchimpJsonp`, `stubTurnstile` | `@pyre/e2e-utils` | Browser-layer stubs (`page.route`). Each returns the requests it answered |
| `waitForMinFillTime`, `fillByName` | `@pyre/e2e-utils` | The forms' anti-bot `form_timestamp` wait, and filling fields by `name` |
| `createMockServer`, `runMockServer`, `mockServerClient` | `@pyre/e2e-utils/server` | A small HTTP server that plays the app's upstream APIs for its server-side code, plus a control API (`/__override`, `/__reset`, `/__requests`) |
| `daysFromNow` | `@pyre/e2e-utils/server` | Fixture dates relative to now, so fixtures never go stale |

Code that runs in a plain Node process, such as the mock server and its
fixtures, imports from `@pyre/e2e-utils/server`. That entry doesn't load
Playwright.

## Two stubbing layers

- **Browser calls** (third parties the page talks to directly, or the app's own
  `/api/*` when a test needs a specific response) are stubbed with `page.route`.
  Everything else outside localhost is aborted, so nothing reaches a real
  service by accident.
- **Server-side calls** (SSR pages, API routes that proxy a third party) never
  pass through the browser. Point the app's upstream base URLs at the app's
  mock server through env vars instead, so the app's own server code runs for
  real against fixtures. The env passed to the app's webServer must also blank
  every credential (`KV_REST_API_URL: ''`, …), because variables set in the
  process take priority over `.env` files.

## Adding a suite for another app

1. `yarn workspace @pyre/<app> add -D @playwright/test "@pyre/e2e-utils@workspace:^"`
2. Write `apps/<app>/playwright.config.ts`:
   ```ts
   import { definePyreConfig } from '@pyre/e2e-utils';
   export default definePyreConfig({
     port: 4339,
     webServers: [
       { name: 'mock upstreams', command: 'yarn tsx e2e/mock-server/server.ts', url: 'http://localhost:4340/__health' },
       { name: '<app>', command: 'yarn dev --port 4339', url: 'http://localhost:4339', env: APP_ENV },
     ],
   });
   ```
   Pick ports no other suite uses. The landing page uses 4329 and 4330.
3. Write `apps/<app>/e2e/test.ts`, exporting `test = createTest({...})` with
   the app's storage seeding and console allowlist. Specs import `test` and
   `expect` from there.
4. Add `"test:e2e": "playwright test"` to the app's scripts, add `e2e/**` to
   its vitest `exclude`, and add `playwright-report/` and `test-results/` to
   its `.gitignore`.
5. In `.github/workflows/e2e.yml`, add a paths filter named after the app's
   directory, and add the name to `ALL_APPS`.

When a helper gets copied into a second app, move it here.

## Selectors

Prefer roles and accessible names (`getByRole`), then the existing `data-*`
hooks and ids. Add a `data-testid` only when neither exists.
