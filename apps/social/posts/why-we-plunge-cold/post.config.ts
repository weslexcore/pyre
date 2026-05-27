import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'why-we-plunge-cold',
  pages: 6,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 8000 },
  ],
  settleMs: 150,
});
