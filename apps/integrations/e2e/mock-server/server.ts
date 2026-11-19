// Mock upstreams for the integrations E2E suite. Started by Playwright's
// webServer (see playwright.config.ts) before `astro dev`, which is pointed
// here by e2e/env.ts:
//
//   /momence/api/v1/*   Momence v1 host-token API (Events)
//   /momence/api/v2/*   Momence v2 host API, including its OAuth token, with
//                       members, sessions and bookings specs add at runtime
//                       (momence-world.ts, driven by e2e/momence.ts)
//   /site/*             the landing site's events and blog feeds
//   /resend/*           Resend: records every email; specs read them back
//                       through mockServerClient(MOCK_URL).requests()
//
// Supabase is not mocked: the suite runs against a real local stack.
// Run on its own with `yarn workspace @pyre/integrations e2e:mock`.

import { type MockRequest, runMockServer } from '@pyre/e2e-utils/server';
import { MOCK_PORT } from '../ports';
import { momenceEvents } from './momence-fixtures';
import { momenceWorld } from './momence-world';

const emptyList = () => ({
  json: { payload: [], pagination: { page: 0, pageSize: 100, totalCount: 0 } },
});

let emailId = 0;
const sent = () => ({ json: { id: `e2e-email-${++emailId}` } });

await runMockServer({
  port: MOCK_PORT,
  log: Boolean(process.env.MOCK_LOG),
  routes: [
    // -- Momence -------------------------------------------------------------
    {
      path: '/momence/api/v1/Events',
      handler: ({ query }: MockRequest) =>
        query.get('hostId') && query.get('token')
          ? { json: momenceEvents() }
          : { status: 401, json: { message: 'Missing hostId or token' } },
    },
    {
      method: 'POST',
      path: '/momence/api/v2/auth/token',
      handler: () => ({
        json: { access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600 },
      }),
    },
    // Members, sessions and bookings that specs added (e2e/momence.ts).
    ...momenceWorld(),
    // Every other host endpoint answers with Momence's list shape, empty: no
    // members, sessions or tags unless a spec overrides a path
    // (mock.override({ path, json })).
    { path: /^\/momence\/api\/v2\/host\//, handler: emptyList },
    { method: 'POST', path: /^\/momence\/api\/v2\/host\//, handler: emptyList },
    // -- The landing site (PUBLIC_SITE_URL) ---------------------------------
    { path: '/site/api/events', handler: () => ({ json: [] }) },
    { path: '/site/api/blog-posts.json', handler: () => ({ json: { posts: [] } }) },
    // -- Resend --------------------------------------------------------------
    { method: 'POST', path: '/resend/emails', handler: sent },
    {
      method: 'POST',
      path: '/resend/emails/batch',
      handler: ({ body }) => ({
        json: {
          data: (Array.isArray(body) ? body : []).map(() => ({ id: `e2e-email-${++emailId}` })),
        },
      }),
    },
  ],
});
