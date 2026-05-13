import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'cold-plunge-womens-health',
  pages: 2,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 7000 },
  ],
  settleMs: 100,
});
