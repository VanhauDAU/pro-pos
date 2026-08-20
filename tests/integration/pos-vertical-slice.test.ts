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
  let weightProductId: string;
  let weightVariantId: string;

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

    const weightUnit = await catalog.createNamed(storeId, 'units', 'Đơn vị cân bất kỳ');
    const weightProduct = await catalog.createProduct(storeId, {
      name: 'Hải sản cân ký',
      productType: 'WEIGHT',
      unitId: weightUnit.id,
      variants: [
        {
          name: 'Giá thường',
          salePriceVnd: 50_000,
          costPriceVnd: 0,
          promptPrice: false,
        },
      ],
    });
    weightProductId = weightProduct.id;
    const weightVariant = await env.DB.prepare(
      'SELECT id FROM product_variants WHERE product_id = ? LIMIT 1',
    )
      .bind(weightProductId)
      .first<{ id: string }>();
    weightVariantId = weightVariant!.id;
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

  it('prices weight items with integer milli-units on add, edit, and invoice', async () => {
    const pos = new PosService(env);
    const order = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-weight-order',
      idempotencyKey: 'weight-order-001',
      note: null,
    });
    const added = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-weight-add',
      idempotencyKey: 'weight-add-001',
      orderId: order.orderId,
      productId: weightProductId,
      variantId: weightVariantId,
      quantityMilli: 500,
      expectedOrderVersion: 1,
      discount: null,
    });
    const halfKilogram = await pos.quote(storeId, order.orderId);
    expect(halfKilogram.items[0]).toMatchObject({
      id: added.itemId,
      productType: 'WEIGHT',
      unitName: 'Đơn vị cân bất kỳ',
      quantityMilli: 500,
      unitPriceVnd: 50_000,
      grossLineTotalVnd: 25_000,
      netLineTotalVnd: 25_000,
    });

    await pos.updateItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-weight-update',
      idempotencyKey: 'weight-update-001',
      orderId: order.orderId,
      itemId: added.itemId,
      expectedOrderVersion: 2,
      quantityMilli: 750,
      note: 'Cân thực tế',
    });
    const threeQuarterKilogram = await pos.quote(storeId, order.orderId);
    expect(threeQuarterKilogram).toMatchObject({
      order: { version: 3 },
      totalVnd: 37_500,
      items: [
        {
          quantityMilli: 750,
          grossLineTotalVnd: 37_500,
          netLineTotalVnd: 37_500,
          note: 'Cân thực tế',
        },
      ],
    });

    const checkout = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-weight-checkout',
      idempotencyKey: 'weight-checkout-001',
      orderId: order.orderId,
      expectedOrderVersion: 3,
      method: 'CASH',
      cashReceivedVnd: 40_000,
    });
    const invoice = await pos.getInvoice(storeId, checkout.invoiceId);
    expect(invoice.lines[0]).toMatchObject({ quantityMilli: 750, lineTotal: 37_500 });
    expect(invoice.payment).toMatchObject({ amount: 37_500, cashChange: 2_500 });
    expect(checkout).toMatchObject({ total: 37_500 });
  });

  it('rejects fractional milli-units for quantity products', async () => {
    const pos = new PosService(env);
    const order = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-fractional-quantity-order',
      idempotencyKey: 'fractional-quantity-order-001',
      note: null,
    });
    await expect(
      pos.addItem({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-fractional-quantity-add',
        idempotencyKey: 'fractional-quantity-add-001',
        orderId: order.orderId,
        productId,
        variantId,
        quantityMilli: 500,
        expectedOrderVersion: 1,
        discount: null,
      }),
    ).rejects.toMatchObject({ code: 'QUANTITY_MUST_BE_WHOLE' });
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
    expect(first.displayCode).toMatch(/^D\d{6}-\d{4,}$/u);

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

  it('allocates unique compact order codes when devices create orders concurrently', async () => {
    const pos = new PosService(env);
    const [one, two] = await Promise.all([
      pos.createTakeaway({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-order-code-1',
        idempotencyKey: 'create-order-code-001',
        note: null,
      }),
      pos.createTakeaway({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-order-code-2',
        idempotencyKey: 'create-order-code-002',
        note: null,
      }),
    ]);

    expect(one.displayCode).not.toBe(two.displayCode);
    expect(one.displayCode).toMatch(/^D\d{6}-\d{4,}$/u);
    expect(two.displayCode).toMatch(/^D\d{6}-\d{4,}$/u);
  });

  it('updates, notes and checks out a takeaway order into an invoice', async () => {
    const pos = new PosService(env);
    const created = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-takeaway-lifecycle-create',
      idempotencyKey: 'takeaway-lifecycle-create-001',
      note: null,
    });
    const added = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-takeaway-lifecycle-add',
      idempotencyKey: 'takeaway-lifecycle-add-001',
      orderId: created.orderId,
      productId,
      variantId,
      quantityMilli: 1000,
      expectedOrderVersion: 1,
      discount: null,
      note: null,
    });
    await pos.updateItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-takeaway-lifecycle-update',
      idempotencyKey: 'takeaway-lifecycle-update-001',
      orderId: created.orderId,
      itemId: added.itemId,
      expectedOrderVersion: 2,
      quantityMilli: 2000,
      note: 'Ít đá',
    });
    await pos.updateNote({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-takeaway-lifecycle-note',
      idempotencyKey: 'takeaway-lifecycle-note-001',
      orderId: created.orderId,
      expectedOrderVersion: 3,
      note: 'Khách chờ tại quầy',
    });
    const quote = await pos.quote(storeId, created.orderId);
    expect(quote).toMatchObject({
      order: { version: 4, note: 'Khách chờ tại quầy' },
      items: [{ quantityMilli: 2000, note: 'Ít đá', netLineTotalVnd: 40_000 }],
      totalVnd: 40_000,
    });

    const checkout = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-takeaway-lifecycle-checkout',
      idempotencyKey: 'takeaway-lifecycle-checkout-001',
      orderId: created.orderId,
      expectedOrderVersion: 4,
      method: 'CASH',
      cashReceivedVnd: 50_000,
    });
    const invoice = await pos.getInvoice(storeId, checkout.invoiceId);
    expect(invoice.invoice).toMatchObject({
      orderType: 'TAKEAWAY',
      total: 40_000,
    });
    expect(invoice.lines[0]).toMatchObject({ quantityMilli: 2000, lineTotal: 40_000 });
    expect(JSON.parse(String(invoice.lines[0]!.snapshotJson))).toMatchObject({ note: 'Ít đá' });
    const payment = await env.DB.prepare(
      'SELECT cash_received AS cashReceived, cash_change AS cashChange FROM takeaway_payments WHERE order_id = ?',
    )
      .bind(created.orderId)
      .first<{ cashReceived: number; cashChange: number }>();
    expect(payment).toEqual({ cashReceived: 50_000, cashChange: 10_000 });
  });

  it('uses one exact cutoff for the final time price, session and invoice snapshot', async () => {
    const opened = await openFreshTable('Bàn exact cutoff', 'open-exact-cutoff-001');
    const startedAt = Date.parse('2026-08-20T10:00:00.000Z');
    const issuedAt = startedAt + 90 * 60_000;
    await env.DB.prepare('UPDATE time_sessions SET started_at = ? WHERE order_id = ?')
      .bind(startedAt, opened.orderId)
      .run();
    await env.DB.prepare('UPDATE orders SET opened_at = ? WHERE id = ?')
      .bind(startedAt, opened.orderId)
      .run();

    const checkout = await new PosService(env).checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-exact-cutoff-checkout',
      idempotencyKey: 'exact-cutoff-checkout-001',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      method: 'CASH',
      cashReceivedVnd: 100_000,
      now: issuedAt,
    });
    expect(checkout.total).toBe(90_000);
    const session = await env.DB.prepare(
      'SELECT status, ended_at AS endedAt FROM time_sessions WHERE order_id = ?',
    )
      .bind(opened.orderId)
      .first<{ status: string; endedAt: number }>();
    expect(session).toEqual({ status: 'ENDED', endedAt: issuedAt });
    const invoice = await new PosService(env).getInvoice(storeId, checkout.invoiceId);
    const snapshot = JSON.parse(String(invoice.invoice!.snapshotJson)) as {
      time: { elapsedSeconds: number; amountAfterRoundingVnd: number; endedAtMs: number };
    };
    expect(snapshot.time).toMatchObject({
      elapsedSeconds: 5400,
      amountAfterRoundingVnd: 90_000,
      endedAtMs: issuedAt,
    });
    expect(invoice.lines.find((line) => line.lineType === 'TIME')).toMatchObject({
      quantityMilli: 5_400_000,
      lineTotal: 90_000,
    });
  });

  it('edits start/end time atomically and recalculates the quote from the saved range', async () => {
    const pos = new PosService(env);
    const opened = await openFreshTable('Bàn chỉnh giờ', 'open-adjust-time-001');
    const now = Date.parse('2026-08-21T10:00:00.000Z');
    const startedAtMs = now - 2 * 60 * 60_000;
    const endedAtMs = now - 30 * 60_000;

    const adjusted = await pos.updateTimeRange({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-adjust-time-1',
      idempotencyKey: 'adjust-time-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      startedAtMs,
      endedAtMs,
      now,
    });
    const replay = await pos.updateTimeRange({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-adjust-time-replay',
      idempotencyKey: 'adjust-time-command-001',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      startedAtMs,
      endedAtMs,
      now,
    });
    expect(replay).toEqual(adjusted);

    const endedQuote = await pos.quote(storeId, opened.orderId, now);
    expect(endedQuote).toMatchObject({
      order: { version: 2 },
      time: {
        status: 'ENDED',
        startedAtMs,
        endedAtMs,
        elapsedSeconds: 5400,
        amountAfterRoundingVnd: 90_000,
      },
      totalVnd: 90_000,
    });

    await pos.updateTimeRange({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-adjust-time-clear-end',
      idempotencyKey: 'adjust-time-command-002',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
      startedAtMs,
      endedAtMs: null,
      now,
    });
    const runningQuote = await pos.quote(storeId, opened.orderId, now);
    expect(runningQuote).toMatchObject({
      order: { version: 3 },
      time: {
        status: 'RUNNING',
        startedAtMs,
        endedAtMs: null,
        elapsedSeconds: 7200,
        amountAfterRoundingVnd: 120_000,
      },
    });

    const audit = await env.DB.prepare(
      `SELECT action FROM audit_logs
       WHERE store_id = ? AND entity_id = ? AND action = 'TIME_RANGE_UPDATED'`,
    )
      .bind(storeId, opened.orderId)
      .all();
    expect(audit.results).toHaveLength(2);

    await expect(
      pos.updateTimeRange({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-adjust-time-invalid',
        idempotencyKey: 'adjust-time-command-invalid',
        orderId: opened.orderId,
        expectedOrderVersion: 3,
        startedAtMs: now + 1,
        endedAtMs: null,
        now,
      }),
    ).rejects.toMatchObject({ code: 'TIME_RANGE_INVALID' });
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
    expect(one.displayCode).toMatch(/^H260820-\d{4,}$/u);
    const payments = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM payments WHERE order_id IN (?, ?)',
    )
      .bind(first.orderId, second.orderId)
      .first<{ total: number }>();
    expect(payments?.total).toBe(2);
  });

  it('blocks a table transfer when the target uses a different time price', async () => {
    const source = await openFreshTable('Bàn chuyển khác giá', 'open-transfer-different-price');
    const catalog = new CatalogService(env);
    const expensiveTimeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ phòng VIP',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: expensiveTimeProduct.id,
      basePriceVnd: 120_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const target = await catalog.createTable({
      storeId,
      areaId,
      timeProductId: expensiveTimeProduct.id,
      name: 'Phòng VIP chuyển giá',
      sortOrder: 20,
    });
    const tables = await new PosService(env).listTables(storeId);
    const sourceTable = tables.find((table) => table.id === source.tableId)!;
    const targetTable = tables.find((table) => table.id === target.id)!;

    await expect(
      new PosService(env).transfer({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-transfer-different-price',
        idempotencyKey: 'transfer-different-price-001',
        orderId: source.orderId,
        targetTableId: target.id,
        expectedOrderVersion: 1,
        expectedSourceTableVersion: Number(sourceTable.version),
        expectedTargetTableVersion: Number(targetTable.version),
      }),
    ).rejects.toMatchObject({ code: 'TABLE_PRICING_CHANGE_REQUIRES_SPLIT' });
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

  it('allows adding and quoting time-based catalogue items without initial end time', async () => {
    const catalog = new CatalogService(env);
    const testTable = await catalog.createTable({
      storeId,
      areaId,
      timeProductId,
      name: 'Bàn Test Giờ',
      sortOrder: 50,
    });
    const pos = new PosService(env);
    const opened = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-open-time-item-table',
      idempotencyKey: 'open-table-time-item-001',
      tableId: testTable.id,
      expectedTableVersion: 1,
    });

    const startTime = 1_700_000_000_000;
    // Add time-priced item without timeEndedAtMs (running session)
    const added = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-add-time-item-1',
      idempotencyKey: 'add-time-item-command-001',
      orderId: opened.orderId,
      productId: timeProductId,
      variantId: null,
      quantityMilli: 1000,
      timeStartedAtMs: startTime,
      timeEndedAtMs: null,
      expectedOrderVersion: 1,
      discount: null,
      now: startTime,
    });
    expect(added.itemId).toBeDefined();

    // 2 hours later, dynamic quote calculates 2 hours for the time item
    const quoteTwoHoursLater = await pos.quote(
      storeId,
      opened.orderId,
      startTime + 2 * 3600 * 1000,
    );
    const itemInQuote = quoteTwoHoursLater.items.find((i) => i.id === added.itemId);
    expect(itemInQuote).toBeDefined();
    expect(itemInQuote?.quantityMilli).toBe(2000);
    expect(itemInQuote?.netLineTotalVnd).toBe(120_000);

    // Updating time item with invalid end time (before start) should throw TIME_RANGE_INVALID
    await expect(
      pos.updateItem({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-update-time-invalid',
        idempotencyKey: 'update-time-invalid-001',
        orderId: opened.orderId,
        itemId: added.itemId,
        expectedOrderVersion: 2,
        quantityMilli: 1000,
        timeStartedAtMs: startTime,
        timeEndedAtMs: startTime - 1000,
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'TIME_RANGE_INVALID' });

    // Updating time item with valid end time (1.5 hours)
    await pos.updateItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-update-time-valid',
      idempotencyKey: 'update-time-valid-001',
      orderId: opened.orderId,
      itemId: added.itemId,
      expectedOrderVersion: 2,
      quantityMilli: 1500,
      timeStartedAtMs: startTime,
      timeEndedAtMs: startTime + 5400 * 1000,
      note: 'Xong 1.5 tiếng',
    });

    const finalizedQuote = await pos.quote(storeId, opened.orderId, startTime + 4 * 3600 * 1000);
    const finalizedItem = finalizedQuote.items.find((i) => i.id === added.itemId);
    expect(finalizedItem?.quantityMilli).toBe(1500);
    expect(finalizedItem?.netLineTotalVnd).toBe(90_000);

    // Test price rounding with arbitrary running duration (e.g. 17 mins 23 secs = 1043s)
    // 60,000 * 1043 / 3600 = 17,383.33 VND -> rounded to 17,000 VND (no fractional money)
    const quoteWithArbitraryDuration = await pos.quote(
      storeId,
      opened.orderId,
      startTime + 5400 * 1000 + 1043 * 1000,
    );
    expect(finalizedItem?.grossLineTotalVnd).toBe(90_000);
    expect(quoteWithArbitraryDuration.time?.amountAfterRoundingVnd).toBeDefined();

    // Test removing table time session with reason
    const removedTime = await pos.removeTimeSession({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-remove-time-session-1',
      idempotencyKey: 'remove-time-session-001',
      orderId: opened.orderId,
      expectedOrderVersion: 3,
      reason: 'Miễn phí tiền giờ bàn cho khách VIP',
    });
    expect(removedTime.removed).toBe(true);

    // Quote after removing table time session: quote.time is null
    const quoteAfterRemovingTime = await pos.quote(
      storeId,
      opened.orderId,
      startTime + 6000 * 1000,
    );
    expect(quoteAfterRemovingTime.time).toBeNull();
    // Only item total remains (90,000 VND)
    expect(quoteAfterRemovingTime.totalVnd).toBe(90_000);

    // Test removing item with reason
    const removedItem = await pos.removeItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-remove-item-1',
      idempotencyKey: 'remove-item-001',
      orderId: opened.orderId,
      itemId: added.itemId,
      expectedOrderVersion: 4,
      reason: 'Khách trả lại món',
    });
    expect(removedItem.removed).toBe(true);

    const quoteAfterRemovingItem = await pos.quote(
      storeId,
      opened.orderId,
      startTime + 6000 * 1000,
    );
    expect(quoteAfterRemovingItem.items.length).toBe(0);
    expect(quoteAfterRemovingItem.totalVnd).toBe(0);
  });
});
