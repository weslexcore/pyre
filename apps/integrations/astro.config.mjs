// @ts-nocheck

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

// Dedicated backend service: SSR-only, no static/GitHub Pages build.
// Hosts the Momence webhook + transactional email system.
export default defineConfig({
  trailingSlash: 'never',
  output: 'server',
  adapter: vercel(),
  integrations: [react()],
});
