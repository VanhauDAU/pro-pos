import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';

describe('online POS vertical slice', () => {
  let storeId: string;
  let ownerUserId: string;
  let tableId: string;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      username: 'system.pos',
      displayName: 'System POS',
      password: 'system-pos-password-long-enough',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'POS Pilot Store',
      ownerDisplayName: 'POS Owner',
      ownerUsername: 'pos.owner',
      ownerPassword: 'pos-owner-password-long-enough',
    }));

    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(storeId, 'areas', 'Khu A');
    const unit = await catalog.createNamed(storeId, 'units', 'Chai');
    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ Pool',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProduct.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const table = await catalog.createTable({
      storeId,
      areaId: area.id,
      timeProductId: timeProduct.id,
      name: 'Bàn 01',
      sortOrder: 1,
    });
    tableId = table.id;

    const product = await catalog.createProduct(storeId, {
      name: 'Nước suối',
      productType: 'QUANTITY',
      unitId: unit.id,
      variants: [
        {
          name: 'Giá mặc định',
          salePriceVnd: 20_000,
          costPriceVnd: 8_000,
          promptPrice: false,
        },
      ],
    });
    productId = product.id;
    const variant = await env.DB.prepare(
      'SELECT id FROM product_variants WHERE product_id = ? LIMIT 1',
    )
      .bind(productId)
      .first<{ id: string }>();
    variantId = variant!.id;
  });

  it('prevents two commands from opening the same table', async () => {
    const pos = new PosService(env);
    const first = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-open-1',
      idempotencyKey: 'open-table-command-001',
      tableId,
      expectedTableVersion: 1,
    });
    expect(first.orderId).toBeTruthy();

    await expect(
      pos.openTable({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-open-2',
        idempotencyKey: 'open-table-command-002',
        tableId,
        expectedTableVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'TABLE_NOT_AVAILABLE' });
  });

  it('adds a snapshotted product and completes idempotent checkout', async () => {
    const pos = new PosService(env);
    const opened = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-open-replay',
      idempotencyKey: 'open-table-command-001',
      tableId,
      expectedTableVersion: 1,
    });
    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-add-1',
      idempotencyKey: 'add-item-command-001',
      orderId: opened.orderId,
      productId,
      variantId,
      quantityMilli: 1000,
      expectedOrderVersion: 1,
      discount: null,
    });
    const quote = await pos.quote(storeId, opened.orderId, Date.now() + 60 * 60_000);
    expect(quote.totalVnd).toBe(80_000);
    expect(quote.order.version).toBe(2);

    const checkout = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-checkout-1',
      idempotencyKey: 'checkout-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
      method: 'CASH',
      cashReceivedVnd: 100_000,
    });
    const replay = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-checkout-replay',
      idempotencyKey: 'checkout-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
      method: 'CASH',
      cashReceivedVnd: 100_000,
    });
    expect(replay.invoiceId).toBe(checkout.invoiceId);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM payments WHERE order_id = ? AND status = 'SUCCEEDED'",
    )
      .bind(opened.orderId)
      .first<{ total: number }>();
    expect(count?.total).toBe(1);

    await expect(
      pos.checkout({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-checkout-2',
        idempotencyKey: 'checkout-command-002',
        orderId: opened.orderId,
        expectedOrderVersion: 2,
        method: 'CASH',
        cashReceivedVnd: 100_000,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_OPEN' });
  });
});
