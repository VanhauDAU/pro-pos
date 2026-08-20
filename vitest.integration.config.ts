import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(currentDirectory, 'migrations')),
          AUTH_PEPPER: 'test-auth-pepper-at-least-32-bytes-long',
          DEVICE_TOKEN_PEPPER: 'test-device-pepper-at-least-32-bytes',
          SESSION_TOKEN_PEPPER: 'test-session-pepper-at-least-32-bytes',
          SYSTEM_BOOTSTRAP_SECRET: 'test-bootstrap-secret-at-least-32-bytes',
          COOKIE_MODE: 'secure',
          ENVIRONMENT: 'staging',
          APP_VERSION: 'test',
          BUILD_SHA: 'test-sha',
          BUILD_TIME: '2026-08-20T00:00:00.000Z',
        },
      },
    })),
  ],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
  },
  resolve: {
    alias: {
      '@contracts': new URL('./src/contracts', import.meta.url).pathname,
      '@domain': new URL('./src/domain', import.meta.url).pathname,
      '@server': new URL('./src/server', import.meta.url).pathname,
    },
  },
});
