// Mock upstreams for the landing page E2E suite. Started by Playwright's
// webServer (see playwright.config.ts) before `astro dev`, which is pointed
// here by MOMENCE_API_BASE and INTEGRATIONS_API_URL (see ../env.ts).
//
//   /momence/*       Momence v1 host-token API: Events, Teachers, Products
//   /integrations/*  apps/integrations: referral lookup and redemption,
//                    partner verification requests
//   /turnstile/*     Cloudflare Turnstile's siteverify
//
// Every request is logged (GET /__requests), so a spec can check that a form
// really reached the upstream, not just that the page said it did.
// Run on its own with `yarn workspace @pyre/landing-page e2e:mock`.

import { type MockRequest, type MockResponse, runMockServer } from '@pyre/e2e-utils/server';
import { E2E_SECRET, MOCK_PORT, TURNSTILE_SECRET, TURNSTILE_TOKEN } from '../env';
import {
  REFERRAL,
  REFERRAL_REJECTIONS,
  REFERRAL_UNKNOWN,
  UPSTREAM_EMAIL_LABEL,
} from './integrations-fixtures';
import { momenceEvents, momenceProducts, momenceTeachers } from './momence-fixtures';

/** Momence authenticates the v1 API with hostId + token query params. */
function momence(respond: () => unknown) {
  return ({ query }: MockRequest): MockResponse =>
    query.get('hostId') && query.get('token')
      ? { json: respond() }
      : { status: 401, json: { message: 'Missing hostId or token' } };
}

/** The integrations service authenticates the landing page with a bearer secret. */
function integrations(respond: (request: MockRequest) => MockResponse) {
  return (request: MockRequest): MockResponse =>
    request.headers.authorization === `Bearer ${E2E_SECRET}`
      ? respond(request)
      : { status: 401, json: { error: 'Unauthorized' } };
}

function emailOf(request: MockRequest): string {
  const body = request.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email : '';
}

/** Emails that have already had their one failure (UPSTREAM_EMAIL_LABEL.failOnce). */
const failedOnce = new Set<string>();
function failsThisTime(email: string): boolean {
  if (!email.startsWith(`${UPSTREAM_EMAIL_LABEL.failOnce}-`) || failedOnce.has(email)) return false;
  failedOnce.add(email);
  return true;
}

await runMockServer({
  port: MOCK_PORT,
  log: Boolean(process.env.MOCK_LOG),
  routes: [
    { path: '/momence/Events', handler: momence(() => momenceEvents()) },
    { path: '/momence/Teachers', handler: momence(() => momenceTeachers) },
    { path: '/momence/Products', handler: momence(() => momenceProducts) },
    {
      path: '/integrations/api/referral/lookup',
      handler: ({ headers, query }) => {
        if (headers.authorization !== `Bearer ${E2E_SECRET}`) {
          return { status: 401, json: { error: 'unauthorized' } };
        }
        // Like the real service (apps/integrations src/lib/referral/registry.ts),
        // lookups are case-insensitive and answer with the canonical code.
        return query.get('code')?.trim().toUpperCase() === REFERRAL.code
          ? { json: REFERRAL }
          : { status: 404, json: REFERRAL_UNKNOWN };
      },
    },
    {
      method: 'POST',
      path: '/integrations/api/referral/redeem',
      // Answers as apps/integrations src/pages/api/referral/redeem.ts does.
      handler: integrations((request) => {
        const email = emailOf(request);
        const { code } = (request.body ?? {}) as { code?: string };
        if (code !== REFERRAL.code) {
          return { status: 400, json: { ok: false, result: 'unknown-code' } };
        }
        const rejection = REFERRAL_REJECTIONS.find((result) => email.startsWith(`${result}-`));
        if (rejection) return { status: 409, json: { ok: false, result: rejection } };
        if (failsThisTime(email)) return { status: 503, json: { ok: false, error: 'unavailable' } };
        return { json: { ok: true, result: 'redeemed' } };
      }),
    },
    {
      method: 'POST',
      path: '/integrations/api/partner/request',
      // Answers as apps/integrations src/pages/api/partner/request.ts does.
      handler: integrations((request) =>
        failsThisTime(emailOf(request))
          ? { status: 503, json: { error: 'storage-unavailable' } }
          : { json: { ok: true } }
      ),
    },
    {
      method: 'POST',
      path: '/turnstile/v0/siteverify',
      // Form-encoded, like Cloudflare's: secret + response.
      handler: ({ body }) => {
        const form = new URLSearchParams(typeof body === 'string' ? body : '');
        const success =
          form.get('secret') === TURNSTILE_SECRET && form.get('response') === TURNSTILE_TOKEN;
        return {
          json: success
            ? { success: true }
            : { success: false, 'error-codes': ['invalid-input-response'] },
        };
      },
    },
  ],
});
