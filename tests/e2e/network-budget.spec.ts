import { expect, test } from '@playwright/test';

test('connected POS is idle without full QR-order or overview polling', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()) && request.url().includes('/api/')) {
      apiRequests.push(new URL(request.url()).pathname);
    }
  });
  await page.goto('/pos/areas');
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
  apiRequests.length = 0;
  await page.waitForTimeout(30_000);

  // WebSocket supplies connected-state updates. The summary endpoint and
  // service-worker requests are intentionally outside this full-list budget.
  expect(apiRequests.filter((path) => path === '/api/v1/pos/qr-orders')).toEqual([]);
  expect(apiRequests.filter((path) => path === '/api/v1/pos/overview')).toEqual([]);
  expect(apiRequests.filter((path) => path === '/api/v1/pos/tables')).toEqual([]);
});
