import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'connection-card',
  pages: 2,
  exports: [{ size: 'business-card', format: 'png', filename: 'connection-card-bleed' }],
  settleMs: 150,
});
