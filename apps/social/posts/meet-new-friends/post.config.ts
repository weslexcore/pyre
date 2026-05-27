import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'meet-new-friends',
  pages: 5,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 5000 },
  ],
  settleMs: 150,
});
