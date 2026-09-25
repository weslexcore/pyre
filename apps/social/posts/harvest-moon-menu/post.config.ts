import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'harvest-moon-menu',
  pages: 2,
  exports: [
    // Page 1: tall print menu, transparent for creme paper.
    { size: 'tall-menu', format: 'png', transparent: true, pages: [1] },
    // Page 2: Instagram feed post with a creme background.
    { size: 'portrait', format: 'png', pages: [2] },
  ],
  settleMs: 150,
});
