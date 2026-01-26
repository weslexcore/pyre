// @ts-nocheck

import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// Manually load .env files using Vite's loadEnv helper
const mode = process.env.NODE_ENV || 'development';
const env = loadEnv(mode, process.cwd(), '');

// Provide fallback values for local development
const PUBLIC_ASTRO_BASE = env.PUBLIC_ASTRO_BASE || '/';
const VERCEL_PROJECT_PRODUCTION_URL =
  env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || 'localhost:4321';

// https://astro.build/config
export default defineConfig({
  // For GitHub Pages project sites, ensure assets work under subpath
  // Override with env vars if deploying to root: PUBLIC_ASTRO_BASE="/" and optionally set VERCEL_PROJECT_PRODUCTION_URL
  site: VERCEL_PROJECT_PRODUCTION_URL.includes('localhost')
    ? `http://${VERCEL_PROJECT_PRODUCTION_URL}`
    : `https://${VERCEL_PROJECT_PRODUCTION_URL}`,
  base: PUBLIC_ASTRO_BASE,
  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [mdx(), react(), sitemap()],

  output: 'server', // Server mode with prerender=true default, allowing SSR API routes
  adapter: vercel({
    imageService: false, // Disable Vercel image optimization (not available on free plan)
    webAnalytics: {
      enabled: true,
    },
  }),

  // Image optimization at build time using Sharp
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        limitInputPixels: false, // Allow large images like florals.png
      },
    },
    // Optimize images at build time, not runtime
    domains: [], // No external image domains needed
    remotePatterns: [], // No remote images
  },
});
