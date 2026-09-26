import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'harvest-moon-menu',
  pages: 3,
  exports: [
    // Page 1: tall print menu, transparent for creme paper.
    { size: 'tall-menu', format: 'png', transparent: true, pages: [1] },
    // Pages 2–3: one Instagram feed post per drink, creme background.
    { size: 'portrait', format: 'png', pages: [2, 3] },
  ],
  settleMs: 150,
});
