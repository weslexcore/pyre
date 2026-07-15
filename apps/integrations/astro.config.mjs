// @ts-nocheck

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

// Dedicated backend service: SSR-only, no static/GitHub Pages build.
// Hosts the Momence webhook + transactional email system.
export default defineConfig({
  trailingSlash: 'never',
  output: 'server',
  // No cookie/session auth anywhere in this service — every route is secured by
  // shared secrets or signatures — so CSRF origin checking only breaks
  // server-to-server webhooks that POST form-encoded bodies without an Origin
  // header (Mailchimp's audience webhook does exactly that).
  security: { checkOrigin: false },
  // maxDuration: the hourly cron tick sweeps Momence + sends email inside a
  // 50s budget (see api/cron/tick.ts), so give functions 60s headroom.
  adapter: vercel({ maxDuration: 60 }),
  integrations: [react()],
});
