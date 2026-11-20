# @pyre/e2e-utils

Shared Playwright setup for the per-app E2E suites. Each app owns its specs in
`apps/<app>/e2e/`; this package holds what they have in common. Two suites use
it: the landing page (`apps/landing-page/e2e/`, mock upstreams only) and
integrations (`apps/integrations/e2e/`, mock upstreams plus a real local
Supabase stack). Start from whichever is closer to the new app.

## What's here

| Export | From | Purpose |
|---|---|---|
| `definePyreConfig` | `@pyre/e2e-utils` | Playwright config with shared defaults: retries and `forbidOnly` in CI, trace on first retry, webServer defaults, the browser in Richmond's timezone (`America/New_York`, `en-US`), and three projects. Every test runs on `chromium` (Desktop Chrome), `mobile-chrome` (Pixel 7) and `mobile-safari` (iPhone 15 on WebKit, the engine behind every iOS browser). `setup: { testMatch }` adds a `setup` project the three depend on, e.g. to seed users and save signed-in `storageState` |
| `MOBILE_ONLY_TAG` | `@pyre/e2e-utils` | Tag a test or `describe` with `{ tag: MOBILE_ONLY_TAG }` to run it on the phone projects only, for behaviour that doesn't exist on desktop (the hamburger menu). Where desktop and phone differ inside one test, branch on the `isMobile` fixture |
| `DESKTOP_ONLY_TAG` | `@pyre/e2e-utils` | Tag tests that never open a page (they use the `request` fixture for a status, redirect or body) so they run once, on `chromium`, not three times |
| `createTest` | `@pyre/e2e-utils` | The base `test`. It seeds localStorage before page scripts run, blocks browser requests to third-party hosts, and fails a test on any page error or `console.error`. Known noise is allowed by default: Chrome's blocked-request message, and WebKit's report of same-origin loads cancelled by a navigation. The seeding is the default of the `seedLocalStorage` option: `test.use({ seedLocalStorage: {} })` turns it off for a file or block (the landing page's popup spec does), rather than racing it with an init script |
| `allowConsole` | `@pyre/e2e-utils` | `test.use({ consoleAllowlist: allowConsole(/status of 404/) })` for expected errors. Use it rather than a bare array, which Playwright reads as a fixture tuple |
| `stubJson`, `stubMailchimpJsonp`, `stubTurnstile` | `@pyre/e2e-utils` | Browser-layer stubs (`page.route`). Each returns the requests it answered. `stubMailchimpJsonp` takes a list to answer successive submissions differently (an error, then a successful retry). The fake Turnstile widget solves again when the page resets it, as the real one does after a failed submission, and marks its container `TURNSTILE_SOLVED` once the page has a token |
| `waitForMinFillTime`, `fillByName` | `@pyre/e2e-utils` | The forms' anti-bot `form_timestamp` wait, and filling fields by `name` |
| `waitForHydration` | `@pyre/e2e-utils` | Wait until every Astro island has mounted. Typing into a React form before then is lost when React takes over the input |
| `expectNoSidewaysScroll` | `@pyre/e2e-utils` | Fail if the page is wider than the screen (on a phone, it scrolls sideways). Call it once the content under test has rendered |
| `uniqueEmail`, `uniqueTag` | `@pyre/e2e-utils` | Per-test, per-project names, for suites whose parallel tests share one database |
| `ensureLocalSupabase`, `resetLocalSupabase`, `stopLocalSupabase` | both | The e2e Supabase stack (below) |
| `supabaseAdmin`, `ensureAuthUser`, `supabaseSessionCookies` | both | A service-role client for seeding and checking rows; an idempotent confirmed Auth user; a user's session as @supabase/ssr cookies, for someone the app's own sign-in would refuse |
| `mailpitClient`, `emailLinks` | both | Read the stack's mail catcher: sign-in links and codes |
| `REFERRAL`, `REFERRAL_UNKNOWN` | both | Shared contracts (`src/contracts/`): what one app's API answers, which another app's suite mocks. The owning app's suite checks its real endpoint against the same value, so the mock can't drift |
| `createMockServer`, `runMockServer`, `mockServerClient` | `@pyre/e2e-utils/server` | A small HTTP server that plays the app's upstream APIs for its server-side code, plus a control API (`/__override`, `/__reset`, `/__requests`, `/__unexpected`) |
| `daysFromNow` | `@pyre/e2e-utils/server` | Fixture dates relative to now, so fixtures never go stale |

Code that runs in a plain Node process, such as the mock server and its
fixtures, imports from `@pyre/e2e-utils/server`. That entry doesn't load
Playwright.

## CI reports and flaky tests

In CI the shared config also writes a JSON report (`test-results/results.json`).
`.github/workflows/e2e.yml` uploads the HTML report and `test-results/` after
every run, pass or fail, and `scripts/report-flaky.mjs` turns the JSON report
into a warning annotation per flaky test (failed, then passed on a retry) and a
table in the job summary. A flaky test never fails the job, but it no longer
goes unnoticed, and its first-retry trace is in the uploaded report.

## Two stubbing layers

- **Browser calls** (third parties the page talks to directly, or the app's own
  `/api/*` when a test needs a specific response) are stubbed with `page.route`.
  Everything else outside localhost is aborted, so nothing reaches a real
  service by accident.
- **Server-side calls** (SSR pages, API routes that proxy a third party) never
  pass through the browser. Point the app's upstream base URLs at the app's
  mock server through env vars instead, so the app's own server code runs for
  real against fixtures. Prefer this for the app's own form handlers too:
  stubbing an app's `/api/*` in the browser skips its validation, bot checks
  and upstream call, and a handler that silently drops a bot answers just like
  a success. Check the mock's request log (`mockServerClient(url).requests()`)
  to prove the upstream call happened. The env passed to the app's webServer must also blank
  every credential (`KV_REST_API_URL: ''`, …), because variables set in the
  process take priority over `.env` files.

## The e2e Supabase stack

`ensureLocalSupabase({ supabaseDir, appOrigin })` gives a suite a real local
Supabase (Postgres, Auth, PostgREST, Realtime, Storage, Mailpit), separate from
the developer's own `pyre` stack:

- It builds a CLI workdir at `apps/supabase/.e2e/` (gitignored) from
  `apps/supabase` on every run: `config.toml` with project id `pyre-e2e`, ports
  553xx (API on 55321, Mailpit on 55324), the app's origin for Auth redirects,
  and no Auth rate limits; plus `migrations/` and `templates/`. Nothing is
  kept in sync by hand.
- It starts the stack if needed (Docker; studio and other unused services left
  out), applies new migrations (`supabase migration up`, falling back to a
  reset when a migration was renamed), and grants the API roles access to the
  replayed tables, as production has. A first run takes about a minute; after
  that, a couple of seconds. A changed config restarts the stack.
- It returns the URLs and keys (the legacy JWT keys, which the local stack
  wants) and caches them in `process.env.E2E_SUPABASE` for the workers.

Call it from the config, before `definePyreConfig`: the app's webServer needs
the keys, and Playwright starts webServers before `globalSetup`. Tests share
one database across workers and projects, so seed under unique names and
never truncate. The app's own caches (a 30s staff roster, say) mean rows a
running app must see should be seeded in the setup project. To start clean:
`resetLocalSupabase(...)` (integrations: `yarn workspace @pyre/integrations
e2e:supabase:reset`).

### Scope mock server overrides

`mockServerClient(url).override(...)` is seen by **every** worker: the app's
server calls carry nothing that ties them to a test. So scope an override to
the calling test's own request with `bodyIncludes` (a string only its request
contains: its unique email, or an entity id in the path) and/or `times` (answer
that many requests, then stand down). `override` resolves to an id; remove it
with `removeOverride(id)` when the test ends. An unscoped override answers
every request on that route, so keep those for specs that run alone.

### Unexpected upstream requests

A request no route or override answers gets a 404 and is kept in
`/__unexpected` (`mockServerClient(url).unexpected()`). A suite should fail
the run when that list isn't empty (integrations does it in its global
teardown), so a mock can't quietly answer an endpoint the app calls wrongly.

### A second person in the same test

`newPage({ storageState })` opens a page in its own browser context, on the
project's device, with the same external-request blocking and browser-error
guard as `page`. Use it rather than `browser.newContext()`.

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
   Pick ports no other suite uses. The landing page uses 4329 and 4330,
   integrations 4339 and 4340, and the Supabase stack 553xx.
   Make the app read no `.env` file under test (Astro: `vite.envDir`, see
   `apps/integrations/astro.config.mjs`), so a variable the suite forgot can
   never fall through to a production value.
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
