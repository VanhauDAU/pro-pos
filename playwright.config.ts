import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env['E2E_BASE_URL'] ?? process.env['PROPOS_E2E_BASE_URL'];
const authStatePath = 'playwright/.auth/pos.json';
const runBrowserMatrix = process.env['E2E_BROWSER_MATRIX'] === 'true';

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
    ...(runBrowserMatrix
      ? [
          {
            name: 'mobile-chromium-authenticated',
            testMatch: /(?:network-budget|payment-regression|cache-consistency)\.spec\.ts/,
            dependencies: ['setup'],
            use: {
              ...devices['Pixel 7'],
              browserName: 'chromium' as const,
              storageState: authStatePath,
            },
          },
          {
            name: 'mobile-webkit-authenticated',
            testMatch: /(?:network-budget|payment-regression|cache-consistency)\.spec\.ts/,
            dependencies: ['setup'],
            use: {
              ...devices['iPhone 15'],
              browserName: 'webkit' as const,
              storageState: authStatePath,
            },
          },
        ]
      : []),
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
