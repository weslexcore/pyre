import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'the-third-place',
  pages: 5,
  exports: [
    { size: 'square', format: 'png' },
    { size: 'portrait', format: 'png' },
  ],
  settleMs: 150,
});
