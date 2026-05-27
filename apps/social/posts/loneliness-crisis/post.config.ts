import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'loneliness-crisis',
  pages: 5,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 7000 },
  ],
  settleMs: 150,
});
