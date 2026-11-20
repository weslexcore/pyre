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

type MailchimpResponse = { result: 'success' | 'error'; msg?: string };

/**
 * Mailchimp's embedded-form JSONP endpoint (`/subscribe/post-json?c=<callback>`).
 * Responds by calling the page's callback with `{ result, msg }`. Pass a list
 * to answer successive submissions differently (an error, then a successful
 * retry); the last entry repeats. Returns the request URLs so a test can
 * assert on the submitted fields (EMAIL, tags, …).
 */
export async function stubMailchimpJsonp(
  page: Page,
  response: MailchimpResponse | MailchimpResponse[] = { result: 'success' }
): Promise<URL[]> {
  const responses = Array.isArray(response) ? response : [response];
  const seen: URL[] = [];
  await page.route('**/subscribe/post-json**', async (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    const callback = url.searchParams.get('c') ?? 'callback';
    const answer = responses[Math.min(seen.length, responses.length) - 1];
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `${callback}(${JSON.stringify({ msg: '', ...answer })});`,
    });
  });
  return seen;
}

/**
 * Set on a widget's container once the fake Turnstile (stubTurnstile) has
 * handed the page its token. Wait for it before a submit that needs one.
 */
export const TURNSTILE_SOLVED = '[data-e2e-turnstile="solved"]';

/**
 * Replace Cloudflare Turnstile's loader with a fake widget that hands back
 * `token` as soon as it renders, and again whenever the page resets it (as
 * the real widget re-runs its challenge after a failed submission, so a
 * retry has a fresh token). Only needed when a suite runs with a site key
 * set; with none, the forms skip Turnstile entirely.
 */
export async function stubTurnstile(page: Page, token = 'e2e-turnstile-token'): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `(function () {
        var token = ${JSON.stringify(token)};
        var widgets = {};
        var next = 0;
        function solve(id) {
          setTimeout(function () {
            var widget = widgets[id];
            if (!widget) return;
            if (widget.el && widget.el.setAttribute) widget.el.setAttribute('data-e2e-turnstile', 'solved');
            if (widget.opts.callback) widget.opts.callback(token);
          }, 0);
        }
        window.turnstile = {
          render: function (el, opts) {
            var id = 'e2e-widget-' + next++;
            var target = typeof el === 'string' ? document.querySelector(el) : el;
            widgets[id] = { el: target, opts: opts };
            solve(id);
            return id;
          },
          reset: function (id) { Object.keys(widgets).forEach(function (key) { if (id === undefined || key === id) solve(key); }); },
          remove: function (id) { delete widgets[id]; },
          getResponse: function () { return token; }
        };
      })();`,
    })
  );
}
