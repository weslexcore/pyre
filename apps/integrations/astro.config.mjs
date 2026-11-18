// @ts-nocheck

import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Set by the E2E suite's webServer (e2e/env.ts).
const E2E = Boolean(process.env.E2E);

// Dedicated backend service: SSR-only, no static/GitHub Pages build.
// Hosts the Momence webhook + transactional email system, plus the /admin
// email-monitoring dashboard.
export default defineConfig({
  trailingSlash: 'never',
  output: 'server',
  // Cookie/session auth exists only on /admin + /api/admin (Supabase Auth,
  // lib/supabase/server).
  // Global CSRF origin checking stays off because it breaks server-to-server
  // webhooks that POST form-encoded bodies without an Origin header
  // (Mailchimp's audience webhook does exactly that). Cookie-authed routes
  // that mutate state must instead defend in-route: require a JSON
  // content-type and call assertSameOrigin() from lib/auth/admin —
  // api/admin/water-tests.ts is the template.
  security: { checkOrigin: false },
  // maxDuration: the hourly cron tick sweeps Momence + sends email inside a
  // 50s budget (see api/cron/tick.ts), so give functions 60s headroom.
  adapter: vercel({ maxDuration: 60 }),
  // Link prefetching for the admin nav, opt-in per link via
  // data-astro-prefetch. `prefetchAll` is deliberately off: it would prefetch
  // every same-origin <a>, including API routes a page links to. (Logout is
  // a POST form, so a prefetch can no longer sign anyone out, but the
  // opt-in default stays.)
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [react()],
  // The toolbar injects its own scripts into every page; tests don't want it.
  devToolbar: { enabled: !E2E },
  vite: {
    plugins: [tailwindcss()],
    // Under E2E, read no .env file at all: apps/integrations/.env points at
    // production, and any variable e2e/env.ts forgot would otherwise fall
    // through to it. e2e/ holds no .env, so the app sees only the process env
    // the suite passes.
    envDir: E2E ? fileURLToPath(new URL('./e2e', import.meta.url)) : undefined,
    // qr-code-styling is only ever imported lazily (the QR button on a
    // campaign link). Without pre-bundling, the dev server discovers it on
    // that first click, re-optimizes, and reloads the page — which closes
    // the QR panel the click just opened and looks like nothing rendered.
    optimizeDeps: { include: ['qr-code-styling'] },
  },
});
