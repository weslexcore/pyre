import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'sauna-across-cultures',
  pages: 6,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 4000 },
  ],
  settleMs: 150,
  transition: { type: 'fade', durationMs: 600 },
});
