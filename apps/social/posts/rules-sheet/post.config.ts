import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'rules-sheet',
  exports: [{ size: 'letter', format: 'png', transparent: true }],
});
