import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'harvest-moon-menu',
  exports: [{ size: 'tall-menu', format: 'png', transparent: true }],
  settleMs: 150,
});
