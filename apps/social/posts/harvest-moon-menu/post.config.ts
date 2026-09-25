import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'harvest-moon-menu',
  exports: [{ size: 'reel', format: 'png', transparent: true }],
  settleMs: 150,
});
