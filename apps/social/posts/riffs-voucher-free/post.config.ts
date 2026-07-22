import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'riffs-voucher-free',
  pages: 2,
  exports: [{ size: 'business-card', format: 'png', filename: 'voucher-card-bleed' }],
  settleMs: 150,
});
