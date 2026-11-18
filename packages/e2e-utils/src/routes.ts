// Browser-layer stubs for third parties more than one app talks to.
//
// Each registers a page.route, which takes precedence over the external-host
// block installed by createTest, so a stubbed host is reachable (answered by
// the stub) while everything else stays blocked.

import type { Page, Request } from '@playwright/test';

/** Answer requests matching `url` with JSON. Returns the requests it answered. */
export async function stubJson(
  page: Page,
  url: string | RegExp,
  body: unknown,
  options: { status?: number; method?: string } = {}
): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(url, async (route) => {
    if (options.method && route.request().method() !== options.method.toUpperCase()) {
      return route.fallback();
    }
    seen.push(route.request());
    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  return seen;
}

/**
 * Mailchimp's embedded-form JSONP endpoint (`/subscribe/post-json?c=<callback>`).
 * Responds by calling the page's callback with `{ result, msg }`. Returns the
 * request URLs so a test can assert on the submitted fields (EMAIL, tags, …).
 */
export async function stubMailchimpJsonp(
  page: Page,
  response: { result: 'success' | 'error'; msg?: string } = { result: 'success' }
): Promise<URL[]> {
  const seen: URL[] = [];
  await page.route('**/subscribe/post-json**', async (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    const callback = url.searchParams.get('c') ?? 'callback';
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `${callback}(${JSON.stringify({ msg: '', ...response })});`,
    });
  });
  return seen;
}

/**
 * Replace Cloudflare Turnstile's loader with a fake widget that immediately
 * hands back `token`. Only needed when a suite runs with a site key set; with
 * none, the forms skip Turnstile entirely.
 */
export async function stubTurnstile(page: Page, token = 'e2e-turnstile-token'): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render: function (el, opts) { setTimeout(function () { opts.callback && opts.callback(${JSON.stringify(token)}); }, 0); return 'e2e-widget'; },
        reset: function () {},
        remove: function () {},
        getResponse: function () { return ${JSON.stringify(token)}; }
      };`,
    })
  );
}
