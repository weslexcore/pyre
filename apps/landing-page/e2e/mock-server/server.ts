// Mock upstreams for the landing page E2E suite. Started by Playwright's
// webServer (see playwright.config.ts) before `astro dev`, which is pointed
// here by MOMENCE_API_BASE and INTEGRATIONS_API_URL (see ../env.ts).
//
//   /momence/*       Momence v1 host-token API: Events, Teachers, Products
//   /integrations/*  apps/integrations: referral lookup
//
// Run on its own with `yarn workspace @pyre/landing-page e2e:mock`.

import { type MockRequest, type MockResponse, runMockServer } from '@pyre/e2e-utils/server';
import { E2E_SECRET, MOCK_PORT } from '../env';
import { REFERRAL } from './integrations-fixtures';
import { momenceEvents, momenceProducts, momenceTeachers } from './momence-fixtures';

/** Momence authenticates the v1 API with hostId + token query params. */
function momence(respond: () => unknown) {
  return ({ query }: MockRequest): MockResponse =>
    query.get('hostId') && query.get('token')
      ? { json: respond() }
      : { status: 401, json: { message: 'Missing hostId or token' } };
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
        return query.get('code')?.toUpperCase() === REFERRAL.code
          ? { json: REFERRAL }
          : { status: 404, json: { error: 'not_found' } };
      },
    },
  ],
});
