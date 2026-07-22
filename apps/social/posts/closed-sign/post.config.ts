import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'closed-sign',
  exports: [{ size: 'letter-landscape', format: 'png', transparent: true }],
  settleMs: 150,
});
