import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'hours-sign',
  exports: [{ size: 'letter', format: 'png', transparent: true }],
  settleMs: 150,
});
