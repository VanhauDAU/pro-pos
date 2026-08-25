import { expect, test } from '@playwright/test';

import {
  activeOrderIds,
  cancelOrder,
  createTimedDineInOrder,
  expectTableAvailable,
} from './pos-fixtures';

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
    const checkout = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/pos/orders/${fixture.orderId}/checkout`) &&
        response.ok(),
    );
    await page.getByRole('button', { name: /^Thanh toán:/ }).click();
    await checkout;
    await expect(page).toHaveURL(/\/pos\/areas/, { timeout: 10_000 });
    await expectTableAvailable(page, fixture.tableId);
    expect(await activeOrderIds(page)).not.toContain(fixture.orderId);
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});
