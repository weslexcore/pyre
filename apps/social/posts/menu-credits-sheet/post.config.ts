import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'menu-credits-sheet',
  pages: 2,
  exports: [{ size: 'letter', format: 'png', transparent: true }],
  settleMs: 150,
});
