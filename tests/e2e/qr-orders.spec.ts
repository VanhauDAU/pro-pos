import { expect, test } from '@playwright/test';

test('QR Order tab fetches the summary on demand and does not poll the full list while connected', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (
      ['fetch', 'xhr'].includes(request.resourceType()) &&
      request.url().includes('/api/v1/pos/qr-orders')
    ) {
      requests.push(new URL(request.url()).pathname);
    }
  });

  await page.goto('/pos/areas');
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
  expect(requests).not.toContain('/api/v1/pos/qr-orders');
  requests.length = 0;

  await page.goto('/pos/qr-order');
  await expect(page.getByLabel('Tổng quan QR Order')).toBeVisible();
  await expect.poll(() => requests).toContain('/api/v1/pos/qr-orders/summary');
  requests.length = 0;
  await page.waitForTimeout(30_000);
  expect(requests).not.toContain('/api/v1/pos/qr-orders');
  expect(requests).not.toContain('/api/v1/pos/qr-orders/summary');
});
