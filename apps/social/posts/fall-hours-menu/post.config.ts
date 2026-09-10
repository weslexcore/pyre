import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'fall-hours-menu',
  exports: [{ size: 'reel', format: 'png', transparent: true }],
  settleMs: 150,
});
