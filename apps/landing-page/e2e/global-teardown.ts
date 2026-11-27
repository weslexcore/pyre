// After the run: fail it if the app made any upstream request the mock server
// has no route for (mock-server/server.ts). Each one got a 404 the app may have
// swallowed, so a test can pass while the app calls an endpoint wrongly.

import { mockServerClient } from '@pyre/e2e-utils/server';
import { MOCK_URL } from './env';

const mock = mockServerClient(MOCK_URL);

export default async function globalTeardown() {
  const unexpected = await mock.unexpected();
  if (unexpected.length === 0) return;
  const lines = [...new Set(unexpected.map((r) => `  ${r.method} ${r.path}`))];
  throw new Error(
    `The app made ${unexpected.length} upstream request(s) the mock server has no route for:\n${lines.join('\n')}\n` +
      'Add a route to e2e/mock-server (or fix the call).'
  );
}
