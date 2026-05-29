import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'menu-drinks',
  exports: [
    // { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png', transparent: true },
    // { size: 'reel', format: 'mp4', duration: 6000 },
    { size: 'small-menu', format: 'png', transparent: true },
  ],
});
