import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'sauna-for-sleep',
  pages: 5,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 4500 },
  ],
  settleMs: 150,
});
