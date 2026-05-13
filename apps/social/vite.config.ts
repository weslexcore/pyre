import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['.'],
    },
  },
  appType: 'mpa',
});
