import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env['E2E_BASE_URL'] ?? process.env['PROPOS_E2E_BASE_URL'];
const authStatePath = 'playwright/.auth/pos.json';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Authenticated POS scenarios mutate one dedicated staging store. Serial
  // execution prevents fixtures from changing table/overview state underneath
  // another financial-consistency assertion.
  workers: 1,
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /login-shell\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'chromium-authenticated',
      testMatch:
        /(?:network-budget|payment-regression|cache-consistency|qr-orders|realtime)\.spec\.ts/,
      dependencies: ['setup'],
      use: { browserName: 'chromium', storageState: authStatePath },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'pnpm preview --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
