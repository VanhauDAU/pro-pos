import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
  resolve: {
    alias: {
      '@contracts': new URL('./src/contracts', import.meta.url).pathname,
      '@domain': new URL('./src/domain', import.meta.url).pathname,
      '@server': new URL('./src/server', import.meta.url).pathname,
    },
  },
});
