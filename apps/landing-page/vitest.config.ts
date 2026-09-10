import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // toc-utils.test.ts predates the test runner and mocks browser globals;
    // it needs a DOM environment (jsdom/happy-dom) that isn't installed.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/lib/toc-utils.test.ts'],
  },
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
