// @ts-nocheck

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// Manually load .env files using Vite's loadEnv helper
const mode = process.env.NODE_ENV || 'development';
const { PUBLIC_ASTRO_BASE, VERCEL_PROJECT_PRODUCTION_URL } = loadEnv(mode, process.cwd(), '');

// https://astro.build/config
export default defineConfig({
  // For GitHub Pages project sites, ensure assets work under subpath
  // Override with env vars if deploying to root: PUBLIC_ASTRO_BASE="/" and optionally set VERCEL_PROJECT_PRODUCTION_URL
  site: `https://${VERCEL_PROJECT_PRODUCTION_URL}`,
  base: PUBLIC_ASTRO_BASE,
  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [react(), sitemap()],

  output: 'server',
  adapter: vercel(),

  // Image optimization configuration
  image: {
    // Enable image optimization
    service: {
      entrypoint: 'astro/assets/services/sharp',
    },
    // Configure supported formats
    formats: ['webp', 'avif'],
    // Responsive image sizes
    densities: [1, 2],
    // Quality settings
    quality: 80,
    // Enable lazy loading by default
    loading: 'lazy',
  },
});
