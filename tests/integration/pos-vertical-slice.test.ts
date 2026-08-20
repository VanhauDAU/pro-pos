import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';

describe('online POS vertical slice', () => {
  let storeId: string;
  let ownerUserId: string;
  let tableId: string;
  let areaId: string;
  let timeProductId: string;
  let productId: string;
  let variantId: string;
  let promptProductId: string;
  let promptVariantId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.pos@example.com',
      displayName: 'System POS',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'POS Pilot Store',
      ownerDisplayName: 'POS Owner',
      ownerEmail: 'pos.owner@example.com',
    }));

    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(storeId, 'areas', 'Khu A');
    areaId = area.id;
    const unit = await catalog.createNamed(storeId, 'units', 'Chai');
    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ Pool',
      productType: 'TIME',
      variants: [],
    });
    timeProductId = timeProduct.id;
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

    const promptProduct = await catalog.createProduct(storeId, {
      name: 'Hàng nhập giá khi bán',
      productType: 'QUANTITY',
      unitId: unit.id,
      variants: [
        {
          name: 'Nhập giá',
          salePriceVnd: null,
          costPriceVnd: 0,
          promptPrice: true,
        },
      ],
    });
    promptProductId = promptProduct.id;
    const promptVariant = await env.DB.prepare(
      'SELECT id FROM product_variants WHERE product_id = ? LIMIT 1',
    )
      .bind(promptProductId)
      .first<{ id: string }>();
    promptVariantId = promptVariant!.id;
  });

  async function openFreshTable(name: string, key: string) {
    const catalog = new CatalogService(env);
    const table = await catalog.createTable({
      storeId,
      areaId,
      timeProductId,
      name,
      sortOrder: 10,
    });
    return new PosService(env).openTable({
      storeId,
      actorId: ownerUserId,
      requestId: `request-${key}`,
      idempotencyKey: key,
      tableId: table.id,
      expectedTableVersion: 1,
    });
  }

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

  it('hides soft-deleted areas and disabled tables from the staff POS', async () => {
    const catalog = new CatalogService(env);
    const deletedArea = await catalog.createAreaLayout(storeId, {
      name: 'Khu vực sẽ xóa',
      tables: [{ name: 'Bàn sẽ ẩn' }],
    });
    await catalog.deleteAreaLayout(storeId, deletedArea.id);

    const tables = await new PosService(env).listTables(storeId);
    expect(tables.some((table) => table.areaId === deletedArea.id)).toBe(false);
    expect(tables.every((table) => table.status !== 'DISABLED')).toBe(true);
  });

  it('groups active variants under one product in the staff sale catalog', async () => {
    const catalog = new CatalogService(env);
    const multiVariant = await catalog.createProduct(storeId, {
      name: 'Nước nhiều size',
      productType: 'QUANTITY',
      variants: [
        { name: 'Nhỏ', salePriceVnd: 10_000, costPriceVnd: 0, promptPrice: false },
        { name: 'Lớn', salePriceVnd: 15_000, costPriceVnd: 0, promptPrice: false },
      ],
    });

    const products = await new PosService(env).listCatalog(storeId);
    const matches = products.filter((product) => product.productId === multiVariant.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.variants).toHaveLength(2);
  });

  it('creates and lists an idempotent takeaway order without a table or time session', async () => {
    const pos = new PosService(env);
    const first = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-create-takeaway-1',
      idempotencyKey: 'create-takeaway-command-001',
      note: 'Khách lấy tại quầy',
    });
    const replay = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-create-takeaway-replay',
      idempotencyKey: 'create-takeaway-command-001',
      note: null,
    });
    expect(replay).toEqual(first);

    const quote = await pos.quote(storeId, first.orderId);
    expect(quote).toMatchObject({
      order: { orderType: 'TAKEAWAY', tableId: null, displayCode: first.displayCode },
      time: null,
      totalVnd: 0,
    });
    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-add-takeaway-1',
      idempotencyKey: 'add-takeaway-item-command-001',
      orderId: first.orderId,
      productId,
      variantId,
      quantityMilli: 1000,
      expectedOrderVersion: 1,
      discount: null,
    });
    const updatedQuote = await pos.quote(storeId, first.orderId);
    expect(updatedQuote).toMatchObject({
      order: { orderType: 'TAKEAWAY', version: 2 },
      totalVnd: 20_000,
    });
    const session = await env.DB.prepare('SELECT id FROM time_sessions WHERE order_id = ?')
      .bind(first.orderId)
      .first();
    expect(session).toBeNull();

    const orders = await pos.listOrders(storeId);
    expect(orders).toContainEqual(
      expect.objectContaining({
        id: first.orderId,
        orderType: 'TAKEAWAY',
        tableId: null,
        totalVnd: 20_000,
      }),
    );
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

  it.each([
    ['no discount', null, 100_000, 0, 100_000],
    ['FIXED discount', { type: 'FIXED' as const, value: 20_000 }, 100_000, 20_000, 80_000],
    ['PERCENT discount', { type: 'PERCENT' as const, value: 20 }, 100_000, 20_000, 80_000],
    ['capped discount', { type: 'FIXED' as const, value: 120_000 }, 100_000, 100_000, 0],
  ])(
    'accounts for %s using gross - discount = total',
    async (label, discount, gross, reduced, net) => {
      const suffix = label.replaceAll(' ', '-').toLowerCase();
      const opened = await openFreshTable(`Bàn ${label}`, `open-${suffix}-001`);
      const pos = new PosService(env);
      await pos.addItem({
        storeId,
        actorId: ownerUserId,
        requestId: `request-add-${suffix}`,
        idempotencyKey: `add-${suffix}-001`,
        orderId: opened.orderId,
        productId,
        variantId,
        quantityMilli: 5000,
        expectedOrderVersion: 1,
        discount,
      });
      const quote = await pos.quote(storeId, opened.orderId);
      expect(quote.subtotalVnd).toBe(gross);
      expect(quote.discountTotalVnd).toBe(reduced);
      expect(quote.totalVnd).toBe(net);
      if (discount) {
        expect(quote.items[0]).toMatchObject({
          discountType: discount.type,
          discountInputValue: discount.value,
          discountAmountVnd: reduced,
          grossLineTotalVnd: gross,
          netLineTotalVnd: net,
        });
      }
    },
  );

  it('supports prompt-price snapshots and ignores entered price for fixed-price variants', async () => {
    const fixed = await openFreshTable('Bàn fixed price', 'open-fixed-price-001');
    const pos = new PosService(env);
    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-fixed-price',
      idempotencyKey: 'add-fixed-price-001',
      orderId: fixed.orderId,
      productId,
      variantId,
      enteredUnitPriceVnd: 1,
      quantityMilli: 1000,
      expectedOrderVersion: 1,
      discount: null,
    });
    const fixedQuote = await pos.quote(storeId, fixed.orderId);
    expect(fixedQuote.items[0]).toMatchObject({ unitPriceVnd: 20_000, netLineTotalVnd: 20_000 });

    const missing = await openFreshTable('Bàn prompt missing', 'open-prompt-missing-001');
    await expect(
      pos.addItem({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-prompt-missing',
        idempotencyKey: 'add-prompt-missing-001',
        orderId: missing.orderId,
        productId: promptProductId,
        variantId: promptVariantId,
        quantityMilli: 1000,
        expectedOrderVersion: 1,
        discount: null,
      }),
    ).rejects.toMatchObject({ code: 'ENTERED_UNIT_PRICE_REQUIRED' });

    await expect(
      pos.addItem({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-prompt-negative',
        idempotencyKey: 'add-prompt-negative-001',
        orderId: missing.orderId,
        productId: promptProductId,
        variantId: promptVariantId,
        enteredUnitPriceVnd: -1,
        quantityMilli: 1000,
        expectedOrderVersion: 1,
        discount: null,
      }),
    ).rejects.toMatchObject({ code: 'ENTERED_UNIT_PRICE_INVALID' });

    const valid = await openFreshTable('Bàn prompt valid', 'open-prompt-valid-001');
    const first = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-prompt-valid',
      idempotencyKey: 'add-prompt-valid-001',
      orderId: valid.orderId,
      productId: promptProductId,
      variantId: promptVariantId,
      enteredUnitPriceVnd: 37_000,
      quantityMilli: 2000,
      expectedOrderVersion: 1,
      discount: null,
    });
    const replay = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-prompt-valid-retry',
      idempotencyKey: 'add-prompt-valid-001',
      orderId: valid.orderId,
      productId: promptProductId,
      variantId: promptVariantId,
      enteredUnitPriceVnd: 99_000,
      quantityMilli: 2000,
      expectedOrderVersion: 1,
      discount: null,
    });
    expect(replay.itemId).toBe(first.itemId);

    const checkedOut = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-prompt-checkout',
      idempotencyKey: 'checkout-prompt-valid-001',
      orderId: valid.orderId,
      expectedOrderVersion: 2,
      method: 'BANK_TRANSFER',
      cashReceivedVnd: null,
    });
    const invoice = await pos.getInvoice(storeId, checkedOut.invoiceId);
    expect(invoice.lines[0]).toMatchObject({
      unitPrice: 37_000,
      grossLineTotal: 74_000,
      lineTotal: 74_000,
    });
    expect(JSON.parse(String(invoice.lines[0]!.snapshotJson))).toMatchObject({
      unitPriceVnd: 37_000,
      netLineTotalVnd: 74_000,
    });
    const itemCount = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM order_items WHERE order_id = ?',
    )
      .bind(valid.orderId)
      .first<{ total: number }>();
    expect(itemCount?.total).toBe(1);
  });

  it('allocates different daily display codes for checkouts at the same timestamp', async () => {
    const first = await openFreshTable('Bàn sequence 1', 'open-sequence-001');
    const second = await openFreshTable('Bàn sequence 2', 'open-sequence-002');
    const pos = new PosService(env);
    const timestamp = Date.parse('2026-08-20T10:00:00.000Z');
    const [one, two] = await Promise.all([
      pos.checkout({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-sequence-checkout-1',
        idempotencyKey: 'checkout-sequence-001',
        orderId: first.orderId,
        expectedOrderVersion: 1,
        method: 'BANK_TRANSFER',
        cashReceivedVnd: null,
        now: timestamp,
      }),
      pos.checkout({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-sequence-checkout-2',
        idempotencyKey: 'checkout-sequence-002',
        orderId: second.orderId,
        expectedOrderVersion: 1,
        method: 'BANK_TRANSFER',
        cashReceivedVnd: null,
        now: timestamp,
      }),
    ]);
    expect(one.displayCode).not.toBe(two.displayCode);
    expect(one.displayCode).toMatch(/^HD-20260820-\d{6}$/u);
    const payments = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM payments WHERE order_id IN (?, ?)',
    )
      .bind(first.orderId, second.orderId)
      .first<{ total: number }>();
    expect(payments?.total).toBe(2);
  });

  it('makes pause/resume atomic, versioned, audited and idempotent', async () => {
    const opened = await openFreshTable('Bàn pause resume', 'open-pause-resume-001');
    const pos = new PosService(env);
    const paused = await pos.pause({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-pause-1',
      idempotencyKey: 'pause-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
    });
    expect(paused.paused).toBe(true);
    const replay = await pos.pause({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-pause-retry',
      idempotencyKey: 'pause-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
    });
    expect(replay.paused).toBe(true);
    await expect(
      pos.pause({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-pause-stale',
        idempotencyKey: 'pause-command-stale',
        orderId: opened.orderId,
        expectedOrderVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_VERSION_CONFLICT' });
    await expect(
      pos.pause({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-pause-invalid-state',
        idempotencyKey: 'pause-command-invalid-state',
        orderId: opened.orderId,
        expectedOrderVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'TIME_NOT_RUNNING' });
    const afterFailedPause = await env.DB.prepare('SELECT version FROM orders WHERE id = ?')
      .bind(opened.orderId)
      .first<{ version: number }>();
    expect(afterFailedPause?.version).toBe(2);

    await pos.resume({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-resume-1',
      idempotencyKey: 'resume-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
    });
    await pos.resume({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-resume-retry',
      idempotencyKey: 'resume-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
    });
    await expect(
      pos.resume({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-resume-invalid',
        idempotencyKey: 'resume-command-invalid',
        orderId: opened.orderId,
        expectedOrderVersion: 3,
      }),
    ).rejects.toMatchObject({ code: 'TIME_NOT_PAUSED' });
    const afterFailedResume = await env.DB.prepare('SELECT version FROM orders WHERE id = ?')
      .bind(opened.orderId)
      .first<{ version: number }>();
    expect(afterFailedResume?.version).toBe(3);
  });
});
