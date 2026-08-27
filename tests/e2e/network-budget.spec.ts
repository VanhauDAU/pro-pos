import { expect, test } from '@playwright/test';

import { cancelOrder, createTimedDineInOrder } from './pos-fixtures';

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

test('connected QR confirmation modal fetches once without five-second polling', async ({
  page,
}) => {
  const qrOrderRequests: number[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/pos/qr-orders') {
      qrOrderRequests.push(Date.now());
    }
  });
  await page.goto('/pos/areas');
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
  qrOrderRequests.length = 0;

  await page.getByTitle('Xác nhận gọi món qua QR').click();
  await expect(
    page.locator('.pos-qr-confirm-modal').getByText('Xác nhận gọi món', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => qrOrderRequests.length).toBe(1);
  qrOrderRequests.length = 0;
  await page.waitForTimeout(16_000);

  expect(qrOrderRequests).toEqual([]);
});

test('connected POS refreshes overview every 15 seconds only while a table is running', async ({
  page,
}) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    const overviewRequests: number[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === '/api/v1/pos/overview'
      ) {
        overviewRequests.push(Date.now());
      }
    });
    await page.goto('/pos/areas');
    await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
    overviewRequests.length = 0;
    await page.waitForTimeout(32_000);

    expect(overviewRequests.length).toBeGreaterThanOrEqual(2);
    expect(overviewRequests.length).toBeLessThanOrEqual(3);
    if (overviewRequests.length >= 2) {
      expect(overviewRequests[1]! - overviewRequests[0]!).toBeGreaterThanOrEqual(13_500);
    }
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});
