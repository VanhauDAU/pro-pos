import { expect, test } from '@playwright/test';

import {
  activeOrderIds,
  cancelOrder,
  createTimedDineInOrder,
  expectTableAvailable,
  quote,
  updateOrderNote,
  type OrderQuote,
} from './pos-fixtures';

test('opening an inactive invalidated order verifies the latest quote first', async ({
  page,
  context,
}) => {
  const fixture = await createTimedDineInOrder(page);
  const secondDevice = await context.newPage();
  try {
    await page.goto(`/pos/orders/${fixture.orderId}`);
    const cached = await quote(page, fixture.orderId);
    await page.getByLabel('Quay lại danh sách').click();
    await expect(page).toHaveURL(/\/pos\/areas/);

    await updateOrderNote(
      secondDevice,
      fixture.orderId,
      cached.order.version,
      `E2E external update ${Date.now()}`,
    );
    const authoritative = await quote(secondDevice, fixture.orderId);
    expect(authoritative.order.version).toBeGreaterThan(cached.order.version);

    const latestQuoteResponse = page.waitForResponse(async (response) => {
      if (
        response.request().method() !== 'GET' ||
        !response.url().endsWith(`/api/v1/pos/orders/${fixture.orderId}/quote`) ||
        !response.ok()
      ) {
        return false;
      }
      const payload = (await response.json()) as { data?: OrderQuote };
      return payload.data?.order.version === authoritative.order.version;
    });
    await page.getByRole('button', { name: new RegExp(fixture.tableName) }).click();
    await latestQuoteResponse;
    await expect(page).toHaveURL(new RegExp(`/pos/orders/${fixture.orderId}$`));
    await expect(page.getByText('Đang xác minh dữ liệu mới nhất của đơn...')).toBeHidden();
  } finally {
    await secondDevice.close();
    await cancelOrder(page, fixture.orderId);
  }
});

test('cancelling an order refreshes Areas without a browser reload', async ({ page }) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    await page.goto(`/pos/orders/${fixture.orderId}`);
    await page.getByRole('button', { name: 'Hủy đơn hàng' }).click();
    await page.getByRole('button', { name: 'Bàn mở nhầm' }).click();
    await page.getByRole('button', { name: 'Xác nhận hủy' }).click();
    await expect(page).toHaveURL(/\/pos\/areas/);
    await expectTableAvailable(page, fixture.tableId);
    expect(await activeOrderIds(page)).not.toContain(fixture.orderId);
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});

test('cash checkout refreshes Areas without a browser reload', async ({ page }) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    await page.goto(`/pos/orders/${fixture.orderId}/payment`);
    await expect(page.getByText('Đang dừng giờ và chốt số tiền trên máy chủ...')).toBeHidden({
      timeout: 20_000,
    });
    const paymentOptions = page.getByRole('button', { name: 'Tùy chọn thanh toán' });
    await expect(paymentOptions).toBeVisible();
    await paymentOptions.click();
    await expect(page.getByText('Thanh toán không in', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const checkout = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/pos/orders/${fixture.orderId}/checkout`) &&
        response.ok(),
    );
    await page.getByRole('button', { name: /^Thanh toán & in:/ }).click();
    await checkout;
    await expect(page.getByText('Thanh toán thành công!')).toBeVisible();
    await expect(page.locator('.pos-payment-celebration button')).toHaveCount(0);
    await expect(page).toHaveURL(/\/pos\/areas/, { timeout: 10_000 });
    await expectTableAvailable(page, fixture.tableId);
    expect(await activeOrderIds(page)).not.toContain(fixture.orderId);
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});
