import { expect, test } from '@playwright/test';

import { cancelOrder, createTimedDineInOrder } from './pos-fixtures';

test('cold POS startup uses one bootstrap and one visible loading state', async ({ page }) => {
  const startupRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) {
      startupRequests.push(new URL(request.url()).pathname);
    }
  });
  await page.route('**/api/v1/app/bootstrap?surface=areas', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.continue();
  });

  await page.goto('/pos/areas');
  await expect(page.locator('.pos-app-splash')).toHaveCount(1);
  await expect(page.locator('.staff-table-card--available').first()).toBeVisible();
  await expect(page.locator('.pos-app-splash')).toHaveCount(0);

  expect(startupRequests.filter((path) => path === '/api/v1/app/bootstrap')).toHaveLength(1);
  expect(startupRequests.filter((path) => path === '/api/v1/auth/context')).toEqual([]);
  expect(startupRequests.filter((path) => path === '/api/v1/pos/context')).toEqual([]);
  expect(startupRequests.filter((path) => path === '/api/v1/pos/overview')).toEqual([]);
});

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

test('connected POS does not poll a running table within the first 30 seconds', async ({
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

    expect(overviewRequests).toEqual([]);
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});

test('connected POS does not poll a running quote within the first 30 seconds', async ({
  page,
}) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    const quoteRequests: number[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname === `/api/v1/pos/orders/${fixture.orderId}/quote`
      ) {
        quoteRequests.push(Date.now());
      }
    });
    await page.goto(`/pos/orders/${fixture.orderId}`);
    await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
    await expect(page.getByText('Đang xác minh dữ liệu mới nhất của đơn...')).toBeHidden();
    quoteRequests.length = 0;
    await page.waitForTimeout(32_000);

    expect(quoteRequests).toEqual([]);
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});

test('opening an occupied table uses one editor quote and does not load print settings', async ({
  page,
}) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    await page.goto('/pos/areas');
    await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
    const paths: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr'].includes(request.resourceType())) {
        paths.push(new URL(request.url()).pathname + new URL(request.url()).search);
      }
    });

    await page.getByRole('button', { name: new RegExp(fixture.tableName) }).click();
    await expect(page).toHaveURL(new RegExp(`/pos/orders/${fixture.orderId}$`));
    await expect(page.getByText('Đang xác minh dữ liệu mới nhất của đơn...')).toBeHidden();

    expect(
      paths.filter((path) => path.startsWith(`/api/v1/pos/orders/${fixture.orderId}/quote`)),
    ).toHaveLength(1);
    expect(paths.filter((path) => path === '/api/v1/pos/print-settings')).toEqual([]);
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});

test('opening an available table and warm catalog picker performs no API request', async ({
  page,
}) => {
  const catalogResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/pos/catalog',
  );
  await page.goto('/pos/areas');
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
  await catalogResponse;
  const paths: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) {
      paths.push(new URL(request.url()).pathname);
    }
  });

  const available = page.locator('.staff-table-card--available').first();
  await expect(available).toBeVisible();
  await available.click();
  await expect(page).toHaveURL(/\/pos\/orders\/new\?tableId=/u);
  await page.getByRole('button', { name: 'Thêm món' }).click();
  await expect(page.getByPlaceholder('Tìm kiếm mặt hàng...')).toBeVisible();

  const criticalPaths = paths.filter(
    (path) =>
      path === '/api/v1/pos/catalog' ||
      path === '/api/v1/pos/tables' ||
      path === '/api/v1/pos/print-settings' ||
      /\/api\/v1\/pos\/orders\/[^/]+\/quote$/u.test(path),
  );
  expect(criticalPaths).toEqual([]);
});
