// @ts-nocheck

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Dedicated backend service: SSR-only, no static/GitHub Pages build.
// Hosts the Momence webhook + transactional email system, plus the /admin
// email-monitoring dashboard.
export default defineConfig({
  trailingSlash: 'never',
  output: 'server',
  // Cookie/session auth exists only on /admin + /api/admin (Momence OAuth).
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
  // every same-origin <a>, and /api/auth/logout is a GET that clears the
  // session cookies — hovering the logout link would sign the user out.
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
