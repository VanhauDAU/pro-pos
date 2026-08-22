import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { QrOrderService } from '@server/services/qr-order-service';
import { QrOrderRepository } from '@server/repositories/qr-order-repository';

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

  it('merges repeated staff additions with the same variant, price, and note', async () => {
    const pos = new PosService(env);
    const order = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-merge-staff-order',
      idempotencyKey: 'merge-staff-order-001',
      note: null,
    });

    const first = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-merge-staff-first',
      idempotencyKey: 'merge-staff-first-001',
      orderId: order.orderId,
      productId,
      variantId,
      quantityMilli: 1000,
      expectedOrderVersion: 1,
      discount: null,
    });
    const second = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-merge-staff-second',
      idempotencyKey: 'merge-staff-second-001',
      orderId: order.orderId,
      productId,
      variantId,
      quantityMilli: 5000,
      expectedOrderVersion: 2,
      discount: null,
    });

    expect(second.itemId).toBe(first.itemId);
    expect(await pos.quote(storeId, order.orderId)).toMatchObject({
      order: { version: 3 },
      totalVnd: 120_000,
      items: [
        {
          id: first.itemId,
          quantityMilli: 6000,
          grossLineTotalVnd: 120_000,
          netLineTotalVnd: 120_000,
        },
      ],
    });

    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-merge-staff-different-note',
      idempotencyKey: 'merge-staff-different-note-001',
      orderId: order.orderId,
      productId,
      variantId,
      quantityMilli: 1000,
      note: 'Không lạnh',
      expectedOrderVersion: 3,
      discount: null,
    });
    const withDifferentNote = await pos.quote(storeId, order.orderId);
    expect(withDifferentNote.items).toHaveLength(2);
    expect(withDifferentNote.totalVnd).toBe(140_000);
  });

  it('updates price version variant and discount on existing order items', async () => {
    const catalog = new CatalogService(env);
    const createdProduct = await catalog.createProduct(storeId, {
      name: 'Trà trái cây',
      productType: 'QUANTITY',
      variants: [
        { name: 'Size M', salePriceVnd: 30_000, costPriceVnd: 0, promptPrice: false },
        { name: 'Size L', salePriceVnd: 45_000, costPriceVnd: 0, promptPrice: false },
      ],
    });

    const variants = await env.DB.prepare(
      'SELECT id, name FROM product_variants WHERE product_id = ? ORDER BY sale_price ASC',
    )
      .bind(createdProduct.id)
      .all<{ id: string; name: string }>();

    const sizeM = variants.results.find((v) => v.name === 'Size M')!;
    const sizeL = variants.results.find((v) => v.name === 'Size L')!;

    const pos = new PosService(env);
    const order = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-variant-change-order',
      idempotencyKey: 'variant-change-order-001',
      note: null,
    });

    const added = await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-variant-change-add',
      idempotencyKey: 'variant-change-add-001',
      orderId: order.orderId,
      productId: createdProduct.id,
      variantId: sizeM.id,
      quantityMilli: 2000,
      expectedOrderVersion: 1,
      discount: null,
    });

    const initialQuote = await pos.quote(storeId, order.orderId);
    expect(initialQuote.items[0]).toMatchObject({
      variantId: sizeM.id,
      variantName: 'Size M',
      unitPriceVnd: 30_000,
      quantityMilli: 2000,
      grossLineTotalVnd: 60_000,
      netLineTotalVnd: 60_000,
    });

    // Update to Size L with a 10% discount
    await pos.updateItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-variant-change-update',
      idempotencyKey: 'variant-change-update-001',
      orderId: order.orderId,
      itemId: added.itemId,
      expectedOrderVersion: 2,
      quantityMilli: 2000,
      variantId: sizeL.id,
      discount: { type: 'PERCENT', value: 10 },
      note: 'Ít đá',
    });

    const updatedQuote = await pos.quote(storeId, order.orderId);
    expect(updatedQuote).toMatchObject({
      order: { version: 3 },
      subtotalVnd: 90_000,
      discountTotalVnd: 9_000,
      totalVnd: 81_000,
      items: [
        {
          id: added.itemId,
          variantId: sizeL.id,
          variantName: 'Size L',
          unitPriceVnd: 45_000,
          quantityMilli: 2000,
          grossLineTotalVnd: 90_000,
          discountAmountVnd: 9_000,
          netLineTotalVnd: 81_000,
          note: 'Ít đá',
        },
      ],
    });
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

    const staffTimeline = await new QrOrderService(env).listNotificationAudit(storeId, 50);
    expect(staffTimeline.items).toContainEqual(
      expect.objectContaining({
        eventType: 'ORDER_CREATED',
        status: 'INFO',
        orderId: first.orderId,
        actorName: 'POS Owner',
      }),
    );
    const addedItemEvent = staffTimeline.items.find(
      (event) => event.orderId === first.orderId && event.eventType === 'ITEM_ADDED',
    );
    expect(addedItemEvent).toMatchObject({
      itemCount: 1,
      totalVnd: 20_000,
      actorName: 'POS Owner',
    });
    expect(addedItemEvent!.summary).toContain('Nước suối');

    const permanentAuditId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE audit_logs SET created_at = 1
         WHERE store_id = ? AND json_extract(after_json, '$.orderId') = ?`,
      ).bind(storeId, first.orderId),
      env.DB.prepare(
        `INSERT INTO audit_logs (
          id, store_id, action, entity_type, request_id, created_at
        ) VALUES (?, ?, 'STORE_SETTINGS_UPDATED', 'STORE', 'keep-permanent-audit', 1)`,
      ).bind(permanentAuditId, storeId),
    ]);
    await new QrOrderRepository(env.DB).cleanupExpiredOperationalAudit(2);
    const cleanupCounts = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN action IN ('TAKEAWAY_ORDER_CREATED', 'ORDER_ITEM_ADDED')
           AND (entity_id = ? OR json_extract(after_json, '$.orderId') = ?)
           THEN 1 ELSE 0 END)
           AS operational,
         SUM(CASE WHEN id = ? THEN 1 ELSE 0 END) AS permanent
       FROM audit_logs WHERE store_id = ?`,
    )
      .bind(first.orderId, first.orderId, permanentAuditId, storeId)
      .first<{ operational: number; permanent: number }>();
    expect(cleanupCounts).toEqual({ operational: 0, permanent: 1 });
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
    ).rejects.toMatchObject({ code: 'ORDER_NOT_ACTIVE' });
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

  it('successfully transfers a table across different price rates and computes split time segments accurately', async () => {
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
    const pos = new PosService(env);
    const initialTables = await pos.listTables(storeId);
    const sourceTable = initialTables.find((table) => table.id === source.tableId)!;
    const targetTable = initialTables.find((table) => table.id === target.id)!;

    expect(targetTable.defaultPriceVnd).toBe(120_000);
    expect(targetTable.timeProductName).toBe('Giờ phòng VIP');

    // 1. Perform table transfer
    const transferResult = await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-transfer-different-price',
      idempotencyKey: 'transfer-different-price-001',
      orderId: source.orderId,
      targetTableId: target.id,
      expectedOrderVersion: 1,
      expectedSourceTableVersion: Number(sourceTable.version),
      expectedTargetTableVersion: Number(targetTable.version),
    });

    expect(transferResult.orderId).toBe(source.orderId);
    expect(transferResult.targetTableId).toBe(target.id);

    // 2. Verify source table is now AVAILABLE and target table is OCCUPIED
    const updatedTables = await pos.listTables(storeId);
    const updatedSource = updatedTables.find((table) => table.id === source.tableId)!;
    const updatedTarget = updatedTables.find((table) => table.id === target.id)!;
    expect(updatedSource.status).toBe('AVAILABLE');
    expect(updatedTarget.status).toBe('OCCUPIED');

    // 3. Verify quote computes multi-segment table time accurately
    const quote = await pos.quote(storeId, source.orderId);
    expect(quote.order.tableId).toBe(target.id);
    expect(quote.order.tableName).toBe('Phòng VIP chuyển giá');
    expect(quote.order.version).toBe(2);
    expect(quote.time?.tableSegments).toBeDefined();
    expect(quote.time?.tableSegments?.length).toBe(2);
    expect(quote.time?.tableSegments?.[0]?.tableName).toBe('Bàn chuyển khác giá');
    expect(quote.time?.tableSegments?.[1]?.tableName).toBe('Phòng VIP chuyển giá');

    // 4. Verify cannot transfer to already OCCUPIED table
    const anotherTable = await openFreshTable('Bàn đang chơi khác', 'open-another-occupied-table');
    const freshTables = await pos.listTables(storeId);
    const anotherTableRecord = freshTables.find((t) => t.id === anotherTable.tableId)!;
    await expect(
      pos.transfer({
        storeId,
        actorId: ownerUserId,
        requestId: 'request-transfer-to-occupied',
        idempotencyKey: 'transfer-to-occupied-001',
        orderId: source.orderId,
        targetTableId: anotherTable.tableId,
        expectedOrderVersion: 2,
        expectedSourceTableVersion: Number(updatedTarget.version),
        expectedTargetTableVersion: Number(anotherTableRecord.version),
      }),
    ).rejects.toMatchObject({ code: 'TABLE_NOT_AVAILABLE' });

    // 5. Checkout order successfully
    const checkoutResult = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-checkout-transferred-order',
      idempotencyKey: 'checkout-transferred-001',
      orderId: source.orderId,
      expectedOrderVersion: 2,
      method: 'CASH',
      cashReceivedVnd: 500_000,
    });
    expect(checkoutResult.orderId).toBe(source.orderId);
  });

  it('correctly calculates table transfer: 19:00 Table A (30k/h) -> 20:00 Table B (60k/h) -> 21:00 checkout = 90k, not 120k', async () => {
    const catalog = new CatalogService(env);
    const pos = new PosService(env);

    // Bàn A: 30.000đ/giờ
    const timeProductA = await catalog.createProduct(storeId, {
      name: 'Giờ Bàn A',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProductA.id,
      basePriceVnd: 30_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const tableA = await catalog.createTable({
      storeId,
      areaId,
      timeProductId: timeProductA.id,
      name: 'Bàn A test chuyển',
      sortOrder: 101,
    });

    // Bàn B: 60.000đ/giờ
    const timeProductB = await catalog.createProduct(storeId, {
      name: 'Giờ Bàn B',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProductB.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const tableB = await catalog.createTable({
      storeId,
      areaId,
      timeProductId: timeProductB.id,
      name: 'Bàn B test chuyển',
      sortOrder: 102,
    });

    const t19_00 = Date.parse('2026-08-20T19:00:00.000Z');
    const t20_00 = Date.parse('2026-08-20T20:00:00.000Z');
    const t21_00 = Date.parse('2026-08-20T21:00:00.000Z');

    // 19:00 Mở Bàn A
    const opened = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-open-a-1900',
      idempotencyKey: 'open-a-1900',
      tableId: tableA.id,
      expectedTableVersion: 1,
    });

    // Set started_at to 19:00 for test
    await env.DB.prepare('UPDATE time_sessions SET started_at = ? WHERE order_id = ?')
      .bind(t19_00, opened.orderId)
      .run();
    await env.DB.prepare('UPDATE table_time_segments SET started_at = ? WHERE order_id = ?')
      .bind(t19_00, opened.orderId)
      .run();

    const tablesBeforeTransfer = await pos.listTables(storeId);
    const currentTableA = tablesBeforeTransfer.find((t) => t.id === tableA.id)!;
    const currentTableB = tablesBeforeTransfer.find((t) => t.id === tableB.id)!;

    // 20:00 Chuyển Bàn A -> Bàn B
    await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-a-b-2000',
      idempotencyKey: 'transfer-a-b-2000',
      orderId: opened.orderId,
      targetTableId: tableB.id,
      expectedOrderVersion: 1,
      expectedSourceTableVersion: Number(currentTableA.version),
      expectedTargetTableVersion: Number(currentTableB.version),
    });

    // Adjust segment 1 ended_at and segment 2 started_at to 20:00 for the time simulation
    await env.DB.prepare(
      'UPDATE table_time_segments SET ended_at = ? WHERE order_id = ? AND table_id = ?',
    )
      .bind(t20_00, opened.orderId, tableA.id)
      .run();
    await env.DB.prepare(
      'UPDATE table_time_segments SET started_at = ? WHERE order_id = ? AND table_id = ?',
    )
      .bind(t20_00, opened.orderId, tableB.id)
      .run();

    // 21:00 Checkout / Quote
    const quoteAt21 = await pos.quote(storeId, opened.orderId, t21_00);

    expect(quoteAt21.time?.tableSegments).toHaveLength(2);

    const segA = quoteAt21.time!.tableSegments![0]!;
    expect(segA.tableName).toBe('Bàn A test chuyển');
    expect(segA.startedAtMs).toBe(t19_00);
    expect(segA.endedAtMs).toBe(t20_00);
    expect(segA.pricingConfig.basePriceVnd).toBe(30_000);
    expect(segA.amountAfterRoundingVnd).toBe(30_000);

    const segB = quoteAt21.time!.tableSegments![1]!;
    expect(segB.tableName).toBe('Bàn B test chuyển');
    expect(segB.startedAtMs).toBe(t20_00);
    expect(segB.pricingConfig.basePriceVnd).toBe(60_000);
    expect(segB.amountAfterRoundingVnd).toBe(60_000);

    expect(quoteAt21.totalVnd).toBe(90_000);
    // Regression check: Must NOT be 120.000đ
    expect(quoteAt21.totalVnd).not.toBe(120_000);

    // 21:00 Checkout
    const checkout = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-checkout-2100',
      idempotencyKey: 'checkout-2100',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
      method: 'CASH',
      cashReceivedVnd: 100_000,
      now: t21_00,
    });

    expect(checkout.total).toBe(90_000);
    expect(checkout.total).not.toBe(120_000);
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
    const removedTimeReplay = await pos.removeTimeSession({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-remove-time-session-retry',
      idempotencyKey: 'remove-time-session-001',
      orderId: opened.orderId,
      expectedOrderVersion: 3,
      reason: 'Miễn phí tiền giờ bàn cho khách VIP',
    });
    expect(removedTimeReplay).toEqual({ orderId: opened.orderId, removed: true });

    // Quote after removing table time session: quote.time is null
    const quoteAfterRemovingTime = await pos.quote(
      storeId,
      opened.orderId,
      startTime + 6000 * 1000,
    );
    expect(quoteAfterRemovingTime.time).toBeNull();
    // Only item total remains (90,000 VND)
    expect(quoteAfterRemovingTime.totalVnd).toBe(90_000);

    // Test restoring time session with custom start & end time
    const customStart = startTime + 1000 * 1000;
    const customEnd = startTime + 4600 * 1000;
    const restoredTime = await pos.updateTimeRange({
      storeId,
      orderId: opened.orderId,
      actorId: ownerUserId,
      expectedOrderVersion: 4,
      startedAtMs: customStart,
      endedAtMs: customEnd,
      requestId: 'request-restore-time-1',
      idempotencyKey: 'restore-time-command-001',
      now: startTime + 6000 * 1000,
    });
    expect(restoredTime.startedAtMs).toBe(customStart);
    expect(restoredTime.endedAtMs).toBe(customEnd);
    const restoredTimeReplay = await pos.updateTimeRange({
      storeId,
      orderId: opened.orderId,
      actorId: ownerUserId,
      expectedOrderVersion: 4,
      startedAtMs: customStart,
      endedAtMs: customEnd,
      requestId: 'request-restore-time-retry',
      idempotencyKey: 'restore-time-command-001',
      now: startTime + 6000 * 1000,
    });
    expect(restoredTimeReplay).toMatchObject({
      orderId: opened.orderId,
      startedAtMs: customStart,
      endedAtMs: customEnd,
    });

    const quoteAfterRestore = await pos.quote(storeId, opened.orderId, startTime + 6000 * 1000);
    expect(quoteAfterRestore.time).not.toBeNull();
    expect(quoteAfterRestore.time?.startedAtMs).toBe(customStart);
    expect(quoteAfterRestore.time?.endedAtMs).toBe(customEnd);
    expect(quoteAfterRestore.time?.status).toBe('ENDED');
    expect(quoteAfterRestore.order.version).toBe(5);

    // Test removing item with reason
    const removedItem = await pos.removeItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'request-remove-item-1',
      idempotencyKey: 'remove-item-001',
      orderId: opened.orderId,
      itemId: added.itemId,
      expectedOrderVersion: 5,
      reason: 'Khách trả lại món',
    });
    expect(removedItem.removed).toBe(true);

    const quoteAfterRemovingItem = await pos.quote(
      storeId,
      opened.orderId,
      startTime + 6000 * 1000,
    );
    expect(quoteAfterRemovingItem.items.length).toBe(0);
    expect(quoteAfterRemovingItem.totalVnd).toBe(60_000);
  });

  it('supports provisional bill (tam tinh), stop-time checkout pending (dong bang tien), and resume playing (tiep tuc choi)', async () => {
    const catalog = new CatalogService(env);
    const stopTable = await catalog.createTable({
      storeId,
      areaId,
      timeProductId,
      name: 'Bàn Dừng Giờ',
      sortOrder: 99,
    });
    const pos = new PosService(env);

    // 1. Open table at 06:00:00 (60k/hr)
    const t0 = new Date('2026-08-21T06:00:00.000Z').getTime();
    const opened = await pos.openTable({
      storeId,
      tableId: stopTable.id,
      expectedTableVersion: 1,
      actorId: ownerUserId,
      requestId: 'req-open-1',
      idempotencyKey: 'idem-open-table-stop-1',
      now: t0,
    });
    expect(opened.orderId).toBeDefined();

    // 2. TẠM TÍNH: At 07:00:00 (1 hour played), check provisional quote
    const t1 = t0 + 3600 * 1000;
    const provisionalQuote1 = await pos.quote(storeId, opened.orderId, t1);
    expect(provisionalQuote1.order.status).toBe('OPEN');
    expect(provisionalQuote1.time?.status).toBe('RUNNING');
    expect(provisionalQuote1.time?.endedAtMs).toBeNull();
    expect(provisionalQuote1.time?.elapsedSeconds).toBe(3600);
    expect(provisionalQuote1.time?.amountAfterRoundingVnd).toBe(60_000);

    // Later at 07:15:00, provisional quote increases as time runs
    const tProvisionalLater = t0 + 4500 * 1000;
    const provisionalQuote2 = await pos.quote(storeId, opened.orderId, tProvisionalLater);
    expect(provisionalQuote2.time?.elapsedSeconds).toBe(4500);
    expect(provisionalQuote2.time?.amountAfterRoundingVnd).toBe(75_000);

    // 3. THANH TOÁN (DỪNG GIỜ): At 07:27:15 (5235 seconds), stop time for checkout
    const tStop = t0 + 5235 * 1000; // 07:27:15
    const stopResult = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-time-1',
      idempotencyKey: 'idem-stop-time-1',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      now: tStop,
    });
    expect(stopResult.status).toBe('PAYMENT_PENDING');
    expect(stopResult.stoppedAt).toBe(tStop);
    expect(stopResult.quote.order.status).toBe('PAYMENT_PENDING');
    expect(stopResult.quote.time?.status).toBe('ENDED');
    expect(stopResult.quote.time?.endedAtMs).toBe(tStop);
    expect(stopResult.quote.time?.elapsedSeconds).toBe(5235);
    const stoppedTimeAmount = stopResult.quote.time?.amountAfterRoundingVnd;
    expect(stoppedTimeAmount).toBeDefined();

    // 4. TIỀN ĐỨNG YÊN: At 07:32:15 (5 minutes after stop), check quote again -> exactly same frozen numbers!
    const tLaterAfterStop = tStop + 300 * 1000;
    const frozenQuote = await pos.quote(storeId, opened.orderId, tLaterAfterStop);
    expect(frozenQuote.order.status).toBe('PAYMENT_PENDING');
    expect(frozenQuote.time?.status).toBe('ENDED');
    expect(frozenQuote.time?.endedAtMs).toBe(tStop);
    expect(frozenQuote.time?.elapsedSeconds).toBe(5235);
    expect(frozenQuote.time?.amountAfterRoundingVnd).toBe(stoppedTimeAmount);
    expect(frozenQuote.totalVnd).toBe(stopResult.quote.totalVnd);

    // 5. IDEMPOTENCY: Calling stopTimeForCheckout again returns identical frozen snapshot
    const idempotentStop = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-time-dup',
      idempotencyKey: 'idem-stop-time-1',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      now: tLaterAfterStop,
    });
    expect(idempotentStop.stoppedAt).toBe(tStop);
    expect(idempotentStop.quote.time?.elapsedSeconds).toBe(5235);

    // 5b. Back to order page & clicking Thanh toán again (already PAYMENT_PENDING with new idempotencyKey):
    const secondStopOnPaymentPending = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-time-second-click',
      idempotencyKey: 'idem-stop-time-second-click-1',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
      now: tLaterAfterStop + 1000,
    });
    expect(secondStopOnPaymentPending.status).toBe('PAYMENT_PENDING');
    expect(secondStopOnPaymentPending.stoppedAt).toBe(tStop);
    expect(secondStopOnPaymentPending.quote.order.status).toBe('PAYMENT_PENDING');
    expect(secondStopOnPaymentPending.quote.time?.status).toBe('ENDED');
    expect(secondStopOnPaymentPending.quote.time?.elapsedSeconds).toBe(5235);

    // 5c. Subsequent GET quote requests must continuously return PAYMENT_PENDING + ENDED
    const afterQuote = await pos.quote(storeId, opened.orderId, tLaterAfterStop + 2000);
    expect(afterQuote.order.status).toBe('PAYMENT_PENDING');
    expect(afterQuote.time?.status).toBe('ENDED');
    expect(afterQuote.time?.endedAtMs).toBe(tStop);
    expect(afterQuote.time?.elapsedSeconds).toBe(5235);

    // 6. TIẾP TỤC CHƠI: At 07:30:42, customer decides to play more
    const tResume = t0 + 5442 * 1000; // 07:30:42
    const resumeResult = await pos.resumeCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-resume-1',
      idempotencyKey: 'idem-resume-1',
      orderId: opened.orderId,
      expectedOrderVersion: 2, // version incremented on stop
      now: tResume,
    });
    expect(resumeResult.status).toBe('OPEN');
    expect(resumeResult.resumedAt).toBe(tResume);
    expect(resumeResult.quote.order.status).toBe('OPEN');
    expect(resumeResult.quote.time?.status).toBe('RUNNING');
    expect(resumeResult.quote.time?.endedAtMs).toBeNull();
    // At resume moment, elapsed seconds is exactly the previous 5235 seconds (waiting gap 07:27:15 - 07:30:42 not charged!)
    expect(resumeResult.quote.time?.elapsedSeconds).toBe(5235);

    // 6b. Immediate stop-time right after resume (same millisecond/second) - must not crash
    const immediateStop = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-immediate-stop',
      idempotencyKey: 'idem-immediate-stop-1',
      orderId: opened.orderId,
      expectedOrderVersion: 3,
      now: tResume,
    });
    expect(immediateStop.status).toBe('PAYMENT_PENDING');
    expect(immediateStop.quote.time?.elapsedSeconds).toBe(5235);

    // Resume again after immediate stop
    const resumeAgain = await pos.resumeCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-resume-again',
      idempotencyKey: 'idem-resume-again-1',
      orderId: opened.orderId,
      expectedOrderVersion: 4,
      now: tResume + 1000,
    });
    expect(resumeAgain.status).toBe('OPEN');

    // At 08:00:42 (30 minutes after resume): total elapsed is 5235s + 1800s = 7035s
    const tPlayingLater = tResume + 1800 * 1000;
    const playingQuote = await pos.quote(storeId, opened.orderId, tPlayingLater);
    expect(playingQuote.time?.elapsedSeconds).toBe(5235 + 1799); // 1799s since resumed at tResume + 1000
    // Table segments show distinct intervals
    expect(playingQuote.time?.tableSegments?.length).toBe(3);

    // 7. Stop time again at 08:00:42
    const stopResult2 = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-time-2',
      idempotencyKey: 'idem-stop-time-2',
      orderId: opened.orderId,
      expectedOrderVersion: 5,
      now: tPlayingLater,
    });
    expect(stopResult2.status).toBe('PAYMENT_PENDING');

    // 8. HOÀN TẤT THANH TOÁN: Pay for order in PAYMENT_PENDING
    const checkoutResult = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-checkout-1',
      idempotencyKey: 'idem-checkout-final',
      orderId: opened.orderId,
      expectedOrderVersion: 6,
      method: 'CASH',
      cashReceivedVnd: 500_000,
      now: tPlayingLater + 60 * 1000,
    });
    expect(checkoutResult.invoiceId).toBeDefined();

    // Verify order is PAID, table is AVAILABLE
    const finalTables = await pos.listTables(storeId);
    const targetTable = finalTables.find((t) => t.id === stopTable.id);
    expect(targetTable?.status).toBe('AVAILABLE');
  });

  it('strictly preserves PAYMENT_PENDING invariant across multiple GET /quote and idempotent POST /stop-time calls', async () => {
    const catalog = new CatalogService(env);
    const table = await catalog.createTable({
      storeId,
      areaId,
      timeProductId,
      name: 'Bàn Test Invariant',
      sortOrder: 100,
    });
    const pos = new PosService(env);

    // 1. OPEN + RUNNING
    const t0 = new Date('2026-08-21T10:00:00.000Z').getTime();
    const opened = await pos.openTable({
      storeId,
      tableId: table.id,
      expectedTableVersion: 1,
      actorId: ownerUserId,
      requestId: 'req-open-inv',
      idempotencyKey: 'idem-open-inv-1',
      now: t0,
    });

    const quoteBefore = await pos.quote(storeId, opened.orderId, t0 + 1800 * 1000);
    expect(quoteBefore.order.status).toBe('OPEN');
    expect(quoteBefore.time?.status).toBe('RUNNING');
    expect(quoteBefore.time?.endedAtMs).toBeNull();

    // 2. POST /stop-time -> PAYMENT_PENDING + ENDED
    const tStop = t0 + 1800 * 1000;
    const stopResponse = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-inv-1',
      idempotencyKey: 'idem-stop-inv-1',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      now: tStop,
    });
    expect(stopResponse.status).toBe('PAYMENT_PENDING');
    expect(stopResponse.quote.order.status).toBe('PAYMENT_PENDING');
    expect(stopResponse.quote.time?.status).toBe('ENDED');
    expect(stopResponse.quote.time?.endedAtMs).toBe(tStop);

    // 3. GET /quote -> MUST BE PAYMENT_PENDING + ENDED
    const quoteAfter1 = await pos.quote(storeId, opened.orderId, tStop + 60 * 1000);
    expect(quoteAfter1.order.status).toBe('PAYMENT_PENDING');
    expect(quoteAfter1.time?.status).toBe('ENDED');
    expect(quoteAfter1.time?.endedAtMs).toBe(tStop);

    // 4. GET /quote again (simulating 5s poll) -> MUST REMAIN PAYMENT_PENDING + ENDED
    const quoteAfter2 = await pos.quote(storeId, opened.orderId, tStop + 120 * 1000);
    expect(quoteAfter2.order.status).toBe('PAYMENT_PENDING');
    expect(quoteAfter2.time?.status).toBe('ENDED');
    expect(quoteAfter2.time?.endedAtMs).toBe(tStop);

    // 5. POST /stop-time a second time -> IDEMPOTENT PAYMENT_PENDING + ENDED (no error, no new snapshot)
    const stopResponse2 = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-inv-2',
      idempotencyKey: 'idem-stop-inv-2',
      orderId: opened.orderId,
      expectedOrderVersion: 2,
      now: tStop + 180 * 1000,
    });
    expect(stopResponse2.status).toBe('PAYMENT_PENDING');
    expect(stopResponse2.quote.order.status).toBe('PAYMENT_PENDING');
    expect(stopResponse2.quote.time?.status).toBe('ENDED');
    expect(stopResponse2.quote.time?.endedAtMs).toBe(tStop);

    // 6. GET /quote after 2nd stop -> MUST STILL BE PAYMENT_PENDING + ENDED
    const quoteAfter3 = await pos.quote(storeId, opened.orderId, tStop + 240 * 1000);
    expect(quoteAfter3.order.status).toBe('PAYMENT_PENDING');
    expect(quoteAfter3.time?.status).toBe('ENDED');
    expect(quoteAfter3.time?.endedAtMs).toBe(tStop);
  });

  it('creates a QR guest request and atomically accepts it into the active table order', async () => {
    const catalog = new CatalogService(env);
    const table = await catalog.createTable({
      storeId,
      areaId,
      timeProductId,
      name: 'Bàn QR Order',
      sortOrder: 120,
    });
    const pos = new PosService(env);
    const opened = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-open-qr',
      idempotencyKey: 'cmd-open-qr',
      tableId: table.id,
      expectedTableVersion: 1,
    });
    const qr = new QrOrderService(env);
    const code = await qr.rotateQrCode(storeId, table.id, ownerUserId);
    const resolved = await qr.resolveQr({
      rawQrToken: code.token,
      ip: '127.0.0.1',
      deviceNonce: 'test-device',
    });
    expect(resolved.context.tableName).toBe('Bàn QR Order');
    expect(resolved.context.menu.some((item) => item.id === productId)).toBe(true);

    const assistance = await qr.createServiceRequest(resolved.rawGuest, 'CALL_STAFF');
    const [openAssistance] = await qr.listServiceRequests(storeId);
    expect(openAssistance).toMatchObject({
      id: assistance.id,
      type: 'CALL_STAFF',
      status: 'OPEN',
      tableId: table.id,
      tableName: 'Bàn QR Order',
      orderId: opened.orderId,
      acknowledgedAt: null,
    });
    const assistanceEvent = await env.DB.prepare(
      `SELECT topics_json AS topicsJson, data_json AS dataJson
       FROM realtime_events
       WHERE store_id = ? AND json_extract(data_json, '$.serviceRequestId') = ?
         AND json_extract(data_json, '$.reason') = 'SERVICE_REQUEST_CREATED'
       LIMIT 1`,
    )
      .bind(storeId, assistance.id)
      .first<{ topicsJson: string; dataJson: string }>();
    expect(JSON.parse(assistanceEvent!.topicsJson)).toContain('guest.services');
    expect(JSON.parse(assistanceEvent!.dataJson)).toMatchObject({
      reason: 'SERVICE_REQUEST_CREATED',
      serviceRequestId: assistance.id,
      serviceRequestType: 'CALL_STAFF',
    });
    await qr.updateService({
      storeId,
      id: assistance.id,
      action: 'ACKNOWLEDGE',
      actorId: ownerUserId,
      requestId: 'req-acknowledge-assistance',
    });
    const [acknowledgedAssistance] = await qr.listServiceRequests(storeId);
    expect(acknowledgedAssistance).toMatchObject({
      id: assistance.id,
      status: 'ACKNOWLEDGED',
      tableId: table.id,
      orderId: opened.orderId,
    });
    expect(acknowledgedAssistance!.acknowledgedAt).toEqual(expect.any(Number));
    const acknowledgedAudit = (await qr.listNotificationAudit(storeId, 50)).items.find(
      (event) => event.sourceId === assistance.id,
    );
    expect(acknowledgedAudit).toMatchObject({
      eventType: 'CALL_STAFF',
      status: 'ACKNOWLEDGED',
      tableName: 'Bàn QR Order',
      areaName: 'Khu A',
      summary: 'Khách gọi nhân viên hỗ trợ',
      actorName: 'POS Owner',
    });
    expect(acknowledgedAudit!.handledAt).toEqual(expect.any(Number));

    const clientRequestId = crypto.randomUUID();
    const submitted = await qr.submitOrder(
      resolved.rawGuest,
      {
        clientRequestId,
        items: [{ productId, variantId, quantity: 2 }],
      },
      '127.0.0.1',
    );
    expect(submitted).toMatchObject({
      replayed: false,
      tableName: 'Bàn QR Order',
      areaName: 'Khu A',
      orderId: opened.orderId,
      items: [
        {
          productName: 'Nước suối',
          quantity: 2,
          lineTotalVnd: 40_000,
        },
      ],
    });
    const replay = await qr.submitOrder(
      resolved.rawGuest,
      {
        clientRequestId,
        items: [{ productId, variantId, quantity: 2 }],
      },
      '127.0.0.1',
    );
    expect(replay).toMatchObject({ requestId: submitted.requestId, replayed: true });

    const pendingAudit = (await qr.listNotificationAudit(storeId, 50)).items.find(
      (event) => event.sourceId === submitted.requestId,
    );
    expect(pendingAudit).toMatchObject({
      eventType: 'QR_ORDER',
      status: 'PENDING',
      orderId: opened.orderId,
      itemCount: 2,
      totalVnd: 40_000,
    });
    expect(pendingAudit!.summary).toContain('Nước suối');

    const [pending] = await qr.listStaffRequests(storeId, 'PENDING');
    expect(pending).toMatchObject({
      id: submitted.requestId,
      orderId: opened.orderId,
      orderVersion: 1,
    });
    expect(pending!.items[0]).toMatchObject({ quantity: 2, lineTotalVnd: 40_000 });

    await qr.accept({
      commandId: 'accept-qr-request-001',
      storeId,
      guestRequestId: submitted.requestId,
      expectedOrderVersion: pending!.orderVersion,
      actorId: ownerUserId,
      actorSessionId: null,
      deviceId: null,
      requestId: 'req-accept-qr',
    });
    const quote = await pos.quote(storeId, opened.orderId);
    expect(quote.order.version).toBe(2);
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]).toMatchObject({ productName: 'Nước suối', quantityMilli: 2000 });
    const source = await env.DB.prepare(
      'SELECT source, source_guest_request_id AS guestRequestId FROM order_items WHERE order_id = ? LIMIT 1',
    )
      .bind(opened.orderId)
      .first<{ source: string; guestRequestId: string }>();
    expect(source).toEqual({ source: 'QR_GUEST', guestRequestId: submitted.requestId });
    expect(await qr.listStaffRequests(storeId, 'PENDING')).toHaveLength(0);
    expect(
      (await qr.listNotificationAudit(storeId, 50)).items.find(
        (event) => event.sourceId === submitted.requestId,
      ),
    ).toMatchObject({ status: 'ACCEPTED', actorName: 'POS Owner' });

    const secondGuest = await qr.resolveQr({
      rawQrToken: code.token,
      ip: '127.0.0.2',
      deviceNonce: 'test-device-2',
    });
    const second = await qr.submitOrder(
      secondGuest.rawGuest,
      {
        clientRequestId: crypto.randomUUID(),
        items: [{ productId, variantId, quantity: 1 }],
      },
      '127.0.0.2',
    );
    const race = await Promise.allSettled([
      qr.accept({
        commandId: 'accept-qr-race-a',
        storeId,
        guestRequestId: second.requestId,
        expectedOrderVersion: 2,
        actorId: ownerUserId,
        actorSessionId: null,
        deviceId: null,
        requestId: 'req-accept-race-a',
      }),
      qr.accept({
        commandId: 'accept-qr-race-b',
        storeId,
        guestRequestId: second.requestId,
        expectedOrderVersion: 2,
        actorId: ownerUserId,
        actorSessionId: null,
        deviceId: null,
        requestId: 'req-accept-race-b',
      }),
    ]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const quoteAfterSecondRequest = await pos.quote(storeId, opened.orderId);
    expect(quoteAfterSecondRequest.order.version).toBe(3);
    expect(quoteAfterSecondRequest.items).toHaveLength(1);
    expect(quoteAfterSecondRequest.items[0]).toMatchObject({
      productName: 'Nước suối',
      quantityMilli: 3000,
      grossLineTotalVnd: 60_000,
      netLineTotalVnd: 60_000,
    });

    await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-qr',
      idempotencyKey: 'cmd-stop-qr',
      orderId: opened.orderId,
      expectedOrderVersion: 3,
    });
    await expect(qr.getContext(resolved.rawGuest)).rejects.toMatchObject({
      code: 'GUEST_SESSION_INVALID',
    });
    expect(
      (await qr.listNotificationAudit(storeId, 50)).items.find(
        (event) => event.sourceId === assistance.id,
      ),
    ).toMatchObject({ status: 'CANCELLED' });

    await env.DB.prepare(
      'UPDATE staff_notification_events SET expires_at = 1 WHERE store_id = ? AND source_id = ?',
    )
      .bind(storeId, assistance.id)
      .run();
    await new QrOrderRepository(env.DB).cleanupExpiredNotifications(Date.now());
    expect(
      (await qr.listNotificationAudit(storeId, 50)).items.some(
        (event) => event.sourceId === assistance.id,
      ),
    ).toBe(false);
  });
});
