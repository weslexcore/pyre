import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'example-summer-launch',
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
    { size: 'reel', format: 'mp4', duration: 6000 },
  ],
});
