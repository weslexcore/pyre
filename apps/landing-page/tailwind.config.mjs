import { pyrePreset } from '@pyre/design-system/tailwind';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [pyrePreset],
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  plugins: [
    // Keep existing plugins that were in use
  ],
};