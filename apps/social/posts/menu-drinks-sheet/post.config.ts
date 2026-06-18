import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'menu-drinks-sheet',
  exports: [{ size: 'letter', format: 'png', transparent: true }],
  settleMs: 150,
});
