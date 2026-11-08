import { defineConfig } from '../../scripts/lib/config.ts';
import { cards } from './cards.data.ts';

export default defineConfig({
  name: 'gift-card',
  // Two pages per card: odd pages are fronts, even pages are backs.
  pages: cards.length * 2,
  exports: [{ size: 'business-card', format: 'png', filename: 'gift-card' }],
  settleMs: 150,
});
