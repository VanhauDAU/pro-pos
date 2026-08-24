import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env['PROPOS_E2E_BASE_URL'];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...(process.env['PROPOS_E2E_STORAGE_STATE']
      ? { storageState: process.env['PROPOS_E2E_STORAGE_STATE'] }
      : {}),
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'pnpm preview --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
