import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'harvest-moon-menu',
  exports: [{ size: 'letter', format: 'png' }],
  settleMs: 150,
});
