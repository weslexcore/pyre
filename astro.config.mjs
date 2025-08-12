// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // For GitHub Pages project sites, ensure assets work under subpath
  // Override with env vars if deploying to root: ASTRO_BASE="/" and optionally set ASTRO_SITE
  site: process.env.ASTRO_SITE,
  base: process.env.ASTRO_BASE ?? '/',
  vite: {
      plugins: [tailwindcss()],
	},

  integrations: [react()],
  
  // Image optimization configuration
  image: {
    // Enable image optimization
    service: {
      entrypoint: 'astro/assets/services/sharp'
    },
    // Configure supported formats
    formats: ['webp', 'avif'],
    // Responsive image sizes
    densities: [1, 2],
    // Quality settings
    quality: 80,
    // Enable lazy loading by default
    loading: 'lazy'
  }
});