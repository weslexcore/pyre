import { definePyreConfig } from '@pyre/e2e-utils';
import { APP_ENV, APP_PORT, MOCK_PORT } from './e2e/env';

// The app runs under `astro dev`: the Vercel adapter has no `astro preview`.
// `--ignore-lock` keeps it in the foreground (Astro backgrounds itself when it
// detects an AI agent) and lets it run beside a developer's own dev server.
// The mock server comes up first, so the app's first server-side Momence
// fetch already has somewhere to go.
export default definePyreConfig({
  port: APP_PORT,
  webServers: [
    {
      name: 'mock upstreams',
      command: 'yarn tsx e2e/mock-server/server.ts',
      url: `http://localhost:${MOCK_PORT}/__health`,
    },
    {
      name: 'landing page',
      command: `yarn astro dev --ignore-lock --port ${APP_PORT} --host localhost`,
      url: `http://localhost:${APP_PORT}`,
      env: APP_ENV,
    },
  ],
});
