import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'gift-card',
  // One blank card: page 1 is the front, page 2 the back. If you add cards to cards.data.ts,
  // set this to two per card (the dev server caches an import of the data file, so don't derive it).
  pages: 2,
  exports: [{ size: 'business-card', format: 'png', filename: 'gift-card' }],
  settleMs: 150,
});
