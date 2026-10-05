import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'essential-oil-blends',
  pages: 9,
  exports: [{ size: 'index-card', format: 'png', filename: 'blend-card', transparent: true }],
  settleMs: 150,
});
