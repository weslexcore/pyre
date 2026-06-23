import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: 'google-review-card',
  exports: [
    { size: 'postcard-4x6', format: 'png', filename: 'review-card-4x6-bleed', transparent: true },
  ],
  settleMs: 150,
});
