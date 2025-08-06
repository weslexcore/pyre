// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
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