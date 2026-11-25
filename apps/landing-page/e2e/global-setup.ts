// Before the run: forget unexpected upstream requests a previous run left on a
// reused mock server (playwright.config.ts reuses servers locally).

import { mockServerClient } from '@pyre/e2e-utils/server';
import { MOCK_URL } from './env';

const mock = mockServerClient(MOCK_URL);

export default async function globalSetup() {
  await mock.clearUnexpected();
}
