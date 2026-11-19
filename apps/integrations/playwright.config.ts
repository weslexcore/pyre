import { definePyreConfig } from '@pyre/e2e-utils';
import { APP_ENV, APP_PORT, MOCK_PORT } from './e2e/env';

// Loading e2e/env starts (or reuses) the e2e Supabase stack and migrates it,
// so it has to be up before the app's webServer gets its keys. Needs Docker.
//
// The app runs under `astro dev`: the Vercel adapter has no `astro preview`.
// `--ignore-lock` keeps it in the foreground (Astro backgrounds itself when it
// detects an AI agent) and lets it run beside a developer's own dev server.
// auth.setup.ts runs first: it seeds the staff roster and signs each role in.
export default definePyreConfig({
  port: APP_PORT,
  // A side-by-side run (E2E_APP_PORT) keeps its own results; each run clears
  // its output folder, which would otherwise wipe the other run's failures.
  ...(process.env.E2E_APP_PORT && {
    overrides: {
      outputDir: `test-results/${APP_PORT}`,
      reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: `playwright-report/${APP_PORT}` }],
      ],
    },
  }),
  setup: { testMatch: /auth\.setup\.ts/ },
  webServers: [
    {
      name: 'mock upstreams',
      command: 'yarn tsx e2e/mock-server/server.ts',
      url: `http://localhost:${MOCK_PORT}/__health`,
    },
    {
      name: 'integrations',
      command: `yarn astro dev --ignore-lock --port ${APP_PORT} --host localhost`,
      url: `http://localhost:${APP_PORT}`,
      env: APP_ENV,
    },
  ],
});
