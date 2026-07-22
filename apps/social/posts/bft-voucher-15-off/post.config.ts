import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'bft-voucher-15-off',
  pages: 2,
  exports: [{ size: 'business-card', format: 'png', filename: 'voucher-card-bleed' }],
  settleMs: 150,
});
