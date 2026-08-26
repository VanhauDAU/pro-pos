import { expect, test } from '@playwright/test';

import { cancelOrder, createTimedDineInOrder, quote } from './pos-fixtures';

test('first payment entry freezes once, survives reload, and resumes exactly once on return', async ({
  page,
}) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/v1/pos/orders/')) {
        mutations.push(new URL(request.url()).pathname);
      }
    });

    await page.goto(`/pos/orders/${fixture.orderId}`);
    const stopTime = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/pos/orders/${fixture.orderId}/stop-time`) &&
        response.ok(),
    );
    await page.getByRole('button', { name: 'Thanh toán', exact: true }).first().click();
    await stopTime;
    await expect(page).toHaveURL(new RegExp(`/pos/orders/${fixture.orderId}(?:/payment)?`));
    expect(page.url()).not.toContain('/orders/new');
    expect(mutations.filter((path) => path.endsWith('/resume-checkout'))).toEqual([]);

    await page.reload();
    await expect(page.getByLabel('Quay lại đơn hàng')).toBeVisible();
    const afterReload = await quote(page, fixture.orderId);
    expect(afterReload.order.id).toBe(fixture.orderId);
    expect(afterReload.order.tableId).toBe(fixture.tableId);
    expect(afterReload.items.length).toBeGreaterThan(0);
    expect(afterReload.order.status).toBe('PAYMENT_PENDING');
    expect(mutations.filter((path) => path.endsWith('/resume-checkout'))).toEqual([]);

    const resume = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/pos/orders/${fixture.orderId}/resume-checkout`) &&
        response.ok(),
    );
    await page.getByLabel('Quay lại đơn hàng').click();
    await resume;
    await expect(page).toHaveURL(new RegExp(`/pos/orders/${fixture.orderId}$`));
    expect(mutations.filter((path) => path.endsWith('/resume-checkout'))).toHaveLength(1);
    const resumedQuote = await quote(page, fixture.orderId);
    expect(resumedQuote.order.status).toBe('OPEN');
    expect(resumedQuote.time?.status).toBe('RUNNING');
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});

test('payment automatically saves item changes without a confirmation step', async ({ page }) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    await page.goto(`/pos/orders/${fixture.orderId}`);
    await page.locator('.staff-compact-order-row').first().click();
    const itemModal = page.locator('.staff-item-detail-modal-v2');
    await expect(itemModal).toBeVisible();
    await itemModal.locator('.staff-item-modal__stepper-btn').last().click();
    await itemModal.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đang thay đổi (1)', { exact: true })).toBeVisible();

    const saveAndBeginCheckout = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/v1/pos/orders/${fixture.orderId}/save`) &&
        response.ok(),
    );
    await page.getByRole('button', { name: 'Thanh toán', exact: true }).first().click();
    const saveResponse = await saveAndBeginCheckout;

    expect(saveResponse.request().postDataJSON()).toMatchObject({
      nextAction: 'BEGIN_CHECKOUT',
      updatedItems: [{ quantityMilli: 2_000 }],
    });
    await expect(page.getByText('Lưu thay đổi và thanh toán?', { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/pos/orders/${fixture.orderId}(?:/payment|\\?checkout=1)`),
    );
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});

test('mobile product picker makes Save primary and View order secondary', async ({ page }) => {
  const fixture = await createTimedDineInOrder(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/pos/orders/${fixture.orderId}`);
    await page.locator('.staff-order-mobile-fab').click();

    await expect(page.getByRole('button', { name: 'Xem đơn', exact: true })).toBeVisible();
    await expect(page.locator('.staff-product-picker-mobile__done-btn.ant-btn-primary')).toHaveText(
      'Lưu đơn',
    );

    await page.getByRole('button', { name: 'Xem đơn', exact: true }).click();
    await expect(page.locator('.staff-order-mobile-fab')).toBeVisible();
  } finally {
    await cancelOrder(page, fixture.orderId);
  }
});
