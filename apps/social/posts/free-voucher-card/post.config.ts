import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'free-voucher-card',
  pages: 2,
  exports: [{ size: 'business-card', format: 'png', filename: 'voucher-card-bleed' }],
  settleMs: 150,
});
