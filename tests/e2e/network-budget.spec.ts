import { expect, test } from '@playwright/test';

test('login shell stays split and does not request audio', async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(requestedUrls.some((url) => /\/sound\/|\.(?:mp3|ogg|wav)(?:\?|$)/iu.test(url))).toBe(
    false,
  );
  expect(requestedUrls.some((url) => url.includes('StaffPosPortalPage-'))).toBe(false);
  expect(requestedUrls.some((url) => url.includes('OwnerPortalPage-'))).toBe(false);
});

test('connected POS is idle without Fetch/XHR polling', async ({ page }) => {
  test.skip(!process.env['PROPOS_E2E_STORAGE_STATE'], 'Requires authenticated POS storage state.');
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()) && request.url().includes('/api/')) {
      apiRequests.push(request.url());
    }
  });
  await page.goto('/pos/areas');
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
  apiRequests.length = 0;
  await page.waitForTimeout(30_000);
  expect(apiRequests).toEqual([]);
  expect(apiRequests.some((url) => url.includes('/api/v1/pos/qr-orders'))).toBe(false);
});

test('first-click checkout does not auto-resume the frozen order', async ({ page }) => {
  test.skip(!process.env['PROPOS_E2E_STORAGE_STATE'], 'Requires authenticated POS storage state.');
  const overviewResponse = await page.request.get('/api/v1/pos/overview');
  const overview = (await overviewResponse.json()) as {
    data?: { orders?: Array<{ id: string; status: string; tableId: string | null }> };
  };
  const order = overview.data?.orders?.find(
    (candidate) => candidate.status === 'OPEN' && candidate.tableId,
  );
  test.skip(!order, 'Requires an open dine-in order.');

  const mutationUrls: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/pos/orders/')) {
      mutationUrls.push(request.url());
    }
  });
  await page.goto(`/pos/orders/${order!.id}`);
  await page.getByRole('button', { name: 'Thanh toán', exact: true }).first().click();
  await expect(page.getByText('Thanh toán', { exact: true }).last()).toBeVisible();
  await page.waitForTimeout(2_000);

  expect(mutationUrls.filter((url) => url.includes('/resume-checkout'))).toEqual([]);
  expect(mutationUrls.filter((url) => url.includes('/stop-time'))).toHaveLength(1);
  await page.getByLabel('Quay lại đơn hàng').click();
});
