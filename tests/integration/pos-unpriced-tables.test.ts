import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';

describe('POS Unpriced Tables Support', () => {
  let storeId: string;
  let ownerUserId: string;
  let unpricedTable1Id: string;
  let unpricedTable2Id: string;
  let unpricedTable4Id: string;
  let pricedTable3Id: string;
  let coffeeProductId: string;
  let coffeeVariantId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.unpriced@example.com',
      displayName: 'System Unpriced Test',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'Unpriced Tables Store',
      ownerDisplayName: 'Store Owner',
      ownerEmail: 'owner.unpriced@example.com',
    }));

    const catalog = new CatalogService(env);

    // 1. Create area layout with default unpriced tables
    const area = await catalog.createAreaLayout(storeId, {
      name: 'Khu Thường (Mặc định không tính giờ)',
      tables: [{ name: 'Bàn 01' }, { name: 'Bàn 02' }, { name: 'Bàn 04' }],
    });
    unpricedTable1Id = area.tableIds[0]!;
    unpricedTable2Id = area.tableIds[1]!;
    unpricedTable4Id = area.tableIds[2]!;

    // 2. Create a priced table in another area
    const vipArea = await catalog.createNamed(storeId, 'areas', 'Khu VIP Có Tính Giờ');
    const vipTimeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ VIP',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: vipTimeProduct.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const pricedTable = await catalog.createTable({
      storeId,
      areaId: vipArea.id,
      timeProductId: vipTimeProduct.id,
      name: 'Bàn VIP 03',
      sortOrder: 1,
    });
    pricedTable3Id = pricedTable.id;

    // 3. Create a beverage product (Cà phê)
    const existingUnits = (await catalog.listNamed(storeId, 'units')).results;
    const lyUnit = existingUnits.find((u) => u.name === 'Ly') ?? existingUnits[0]!;

    const coffee = await catalog.createProduct(storeId, {
      name: 'Cà phê đen',
      productType: 'QUANTITY',
      unitId: lyUnit.id,
      variants: [
        {
          name: 'Ly thường',
          salePriceVnd: 25_000,
          costPriceVnd: 10_000,
          promptPrice: false,
        },
      ],
    });
    coffeeProductId = coffee.id;
    const variantRow = await env.DB.prepare(
      'SELECT id FROM product_variants WHERE product_id = ? LIMIT 1',
    )
      .bind(coffee.id)
      .first<{ id: string }>();
    coffeeVariantId = variantRow!.id;
  });

  it('allows openTable on an unpriced table without TABLE_PRICING_MISSING error', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T10:00:00+07:00').getTime();

    const openRes = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-open-unpriced-1',
      idempotencyKey: 'cmd-open-unpriced-1',
      tableId: unpricedTable1Id,
      expectedTableVersion: 1,
      now: t0,
    });

    expect(openRes.orderId).toBeDefined();

    const posTable = (await pos.listTables(storeId, t0)).find(
      (table) => table.id === unpricedTable1Id,
    );
    expect(posTable).toMatchObject({
      timeProductId: null,
      timeProductName: null,
      defaultPriceVnd: null,
    });

    // Table should be occupied
    const tableRow = await env.DB.prepare('SELECT status, version FROM service_tables WHERE id = ?')
      .bind(unpricedTable1Id)
      .first<{ status: string; version: number }>();
    expect(tableRow?.status).toBe('OCCUPIED');

    // No time session should exist for unpriced table order
    const sessionRow = await env.DB.prepare('SELECT id FROM time_sessions WHERE order_id = ?')
      .bind(openRes.orderId)
      .first<{ id: string }>();
    expect(sessionRow).toBeNull();

    // No table time segment should exist
    const segmentRow = await env.DB.prepare('SELECT id FROM table_time_segments WHERE order_id = ?')
      .bind(openRes.orderId)
      .first<{ id: string }>();
    expect(segmentRow).toBeNull();

    // Quote should return time: null and 0 subtotal
    const quote = await pos.quote(storeId, openRes.orderId, t0 + 1800_000);
    expect(quote.time).toBeNull();
    expect(quote.subtotalVnd).toBe(0);
    expect(quote.totalVnd).toBe(0);

    // Order detail DTO should have timeSummary: null and timeSegments: []
    const detail = await pos.getOrderDetail(storeId, openRes.orderId, t0 + 1800_000);
    expect(detail.order.status).toBe('OPEN');
    expect(detail.order.tableName).toBe('Bàn 01');
    expect(detail.timeSummary).toBeNull();
    expect(detail.timeSegments).toEqual([]);
  });

  it('allows saveOrder directly on an unpriced table with items', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T11:00:00+07:00').getTime();

    const saved = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-save-unpriced-2',
      idempotencyKey: 'cmd-save-unpriced-2',
      values: {
        orderType: 'DINE_IN',
        tableId: unpricedTable2Id,
        expectedTableVersion: 1,
        items: [
          {
            productId: coffeeProductId,
            variantId: coffeeVariantId,
            quantityMilli: 2000, // 2 ly cà phê = 50,000 VND
            note: 'Ít đường',
          },
        ],
      },
    });

    expect(saved.order.id).toBeDefined();
    expect(saved.order.status).toBe('OPEN');
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0]!.productName).toBe('Cà phê đen');
    expect(saved.items[0]!.quantityMilli).toBe(2000);

    // Quote should reflect only beverage items, NO time charges
    const quote = await pos.quote(storeId, saved.order.id, t0 + 3600_000);
    expect(quote.time).toBeNull();
    expect(quote.subtotalVnd).toBe(50_000);
    expect(quote.totalVnd).toBe(50_000);

    // Time session should NOT exist
    const session = await env.DB.prepare('SELECT id FROM time_sessions WHERE order_id = ?')
      .bind(saved.order.id)
      .first<{ id: string }>();
    expect(session).toBeNull();
  });

  it('checks out unpriced table order without generating a TIME invoice line', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T12:00:00+07:00').getTime();

    // Get the order from previous test on unpricedTable2Id
    const orderRow = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE table_id = ? AND status = 'OPEN'",
    )
      .bind(unpricedTable2Id)
      .first<{ id: string; version: number }>();
    expect(orderRow).not.toBeNull();

    const checkoutRes = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-checkout-unpriced-2',
      idempotencyKey: 'cmd-checkout-unpriced-2',
      orderId: orderRow!.id,
      expectedOrderVersion: orderRow!.version,
      method: 'CASH',
      cashReceivedVnd: 50_000,
      now: t0,
    });

    expect(checkoutRes.invoiceId).toBeDefined();

    // Table 2 should be back to AVAILABLE
    const tableRow = await env.DB.prepare('SELECT status FROM service_tables WHERE id = ?')
      .bind(unpricedTable2Id)
      .first<{ status: string }>();
    expect(tableRow?.status).toBe('AVAILABLE');

    // Invoice lines should have NO line with line_type = 'TIME'
    const invoiceLines = await env.DB.prepare(
      `SELECT line_type, description, line_total
       FROM invoice_lines
       WHERE invoice_id = ?`,
    )
      .bind(checkoutRes.invoiceId)
      .all<{ line_type: string; description: string; line_total: number }>();

    expect(invoiceLines.results.some((l) => l.line_type === 'TIME')).toBe(false);
    expect(invoiceLines.results).toHaveLength(1);
    expect(invoiceLines.results[0]!.description).toBe('Cà phê đen');
    expect(invoiceLines.results[0]!.line_total).toBe(50_000);
  });

  it('transfers an order between two unpriced tables seamlessly', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T13:00:00+07:00').getTime();

    // unpricedTable1Id is occupied from test 1
    const orderRow = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE table_id = ? AND status = 'OPEN'",
    )
      .bind(unpricedTable1Id)
      .first<{ id: string; version: number }>();
    expect(orderRow).not.toBeNull();

    const targetTableRow = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable4Id)
      .first<{ version: number }>();

    const sourceTableRow = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable1Id)
      .first<{ version: number }>();

    const transferRes = await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-unpriced-to-unpriced',
      idempotencyKey: 'cmd-transfer-unpriced-to-unpriced',
      orderId: orderRow!.id,
      targetTableId: unpricedTable4Id,
      expectedOrderVersion: orderRow!.version,
      expectedSourceTableVersion: sourceTableRow!.version,
      expectedTargetTableVersion: targetTableRow!.version,
      now: t0,
    });

    expect(transferRes.targetTableId).toBe(unpricedTable4Id);

    // Table 1 should now be AVAILABLE
    const sourceAfter = await env.DB.prepare('SELECT status FROM service_tables WHERE id = ?')
      .bind(unpricedTable1Id)
      .first<{ status: string }>();
    expect(sourceAfter?.status).toBe('AVAILABLE');

    // Table 4 should now be OCCUPIED
    const targetAfter = await env.DB.prepare('SELECT status FROM service_tables WHERE id = ?')
      .bind(unpricedTable4Id)
      .first<{ status: string }>();
    expect(targetAfter?.status).toBe('OCCUPIED');

    // Still no time session
    const session = await env.DB.prepare('SELECT id FROM time_sessions WHERE order_id = ?')
      .bind(orderRow!.id)
      .first<{ id: string }>();
    expect(session).toBeNull();
  });

  it('transfers from unpriced table to priced table (starts hourly billing)', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T14:00:00+07:00').getTime();

    // Order is currently on unpricedTable4Id
    const orderRow = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE table_id = ? AND status = 'OPEN'",
    )
      .bind(unpricedTable4Id)
      .first<{ id: string; version: number }>();
    expect(orderRow).not.toBeNull();

    const sourceTableRow = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable4Id)
      .first<{ version: number }>();
    const targetTableRow = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(pricedTable3Id)
      .first<{ version: number }>();

    const transferRes = await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-unpriced-to-priced',
      idempotencyKey: 'cmd-transfer-unpriced-to-priced',
      orderId: orderRow!.id,
      targetTableId: pricedTable3Id,
      expectedOrderVersion: orderRow!.version,
      expectedSourceTableVersion: sourceTableRow!.version,
      expectedTargetTableVersion: targetTableRow!.version,
      now: t0,
    });

    expect(transferRes.targetTableId).toBe(pricedTable3Id);

    // A new time session should now be active for pricedTable3Id
    const session = await env.DB.prepare(
      "SELECT id, status, pricing_version FROM time_sessions WHERE order_id = ? AND status = 'RUNNING'",
    )
      .bind(orderRow!.id)
      .first<{ id: string; status: string; pricing_version: number }>();
    expect(session).not.toBeNull();
    expect(session?.pricing_version).toBeGreaterThan(0);

    // Active time segment should exist
    const segment = await env.DB.prepare(
      'SELECT id, unit_price_snapshot FROM table_time_segments WHERE order_id = ? AND ended_at IS NULL',
    )
      .bind(orderRow!.id)
      .first<{ id: string; unit_price_snapshot: number }>();
    expect(segment).not.toBeNull();
    expect(segment?.unit_price_snapshot).toBe(60_000);

    // Quote 1 hour later should include 60,000 VND time billing
    const t1 = t0 + 3600_000;
    const quote = await pos.quote(storeId, orderRow!.id, t1);
    expect(quote.time).not.toBeNull();
    expect(quote.time?.amountAfterRoundingVnd).toBe(60_000);
  });

  it('transfers from priced table back to unpriced table (ends hourly billing)', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T15:00:00+07:00').getTime();

    // Order is currently on pricedTable3Id
    const orderRow = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE table_id = ? AND status = 'OPEN'",
    )
      .bind(pricedTable3Id)
      .first<{ id: string; version: number }>();
    expect(orderRow).not.toBeNull();

    const sourceTableRow = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(pricedTable3Id)
      .first<{ version: number }>();
    const targetTableRow = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable1Id)
      .first<{ version: number }>();

    const transferRes = await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-priced-to-unpriced',
      idempotencyKey: 'cmd-transfer-priced-to-unpriced',
      orderId: orderRow!.id,
      targetTableId: unpricedTable1Id,
      expectedOrderVersion: orderRow!.version,
      expectedSourceTableVersion: sourceTableRow!.version,
      expectedTargetTableVersion: targetTableRow!.version,
      now: t0,
    });

    expect(transferRes.targetTableId).toBe(unpricedTable1Id);

    // The time session should now be ENDED
    const session = await env.DB.prepare(
      'SELECT id, status, ended_at FROM time_sessions WHERE order_id = ?',
    )
      .bind(orderRow!.id)
      .first<{ id: string; status: string; ended_at: number }>();
    expect(session?.status).toBe('ENDED');
    expect(session?.ended_at).toBe(t0);

    // All table time segments should be closed (ended_at IS NOT NULL)
    const openSegments = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM table_time_segments WHERE order_id = ? AND ended_at IS NULL',
    )
      .bind(orderRow!.id)
      .first<{ cnt: number }>();
    expect(openSegments?.cnt).toBe(0);

    // Historical charges remain visible, but the old rate must never be reopened
    // while the order is currently assigned to an unpriced table.
    const quoteOneHourLater = await pos.quote(storeId, orderRow!.id, t0 + 3600_000);
    expect(quoteOneHourLater.time?.status).toBe('ENDED');
    expect(quoteOneHourLater.time?.amountAfterRoundingVnd).toBe(60_000);

    await expect(
      pos.updateTimeRange({
        storeId,
        actorId: ownerUserId,
        requestId: 'req-reopen-time-on-unpriced',
        idempotencyKey: 'cmd-reopen-time-on-unpriced',
        orderId: orderRow!.id,
        expectedOrderVersion: quoteOneHourLater.order.version,
        startedAtMs: quoteOneHourLater.time!.startedAtMs,
        endedAtMs: null,
        now: t0 + 3600_000,
      }),
    ).rejects.toMatchObject({ code: 'TABLE_PRICING_MISSING' });

    const sessionAfterRejectedResume = await env.DB.prepare(
      'SELECT status, ended_at FROM time_sessions WHERE order_id = ?',
    )
      .bind(orderRow!.id)
      .first<{ status: string; ended_at: number }>();
    expect(sessionAfterRejectedResume).toEqual({ status: 'ENDED', ended_at: t0 });
  });

  it('preserves the free gap and starts a fresh segment when returning to a priced table', async () => {
    const pos = new PosService(env);
    const movedBetweenFreeTablesAt = new Date('2026-09-01T15:30:00+07:00').getTime();
    const returnedToPricedAt = new Date('2026-09-01T16:00:00+07:00').getTime();
    const quotedAt = new Date('2026-09-01T17:00:00+07:00').getTime();

    const order = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE table_id = ? AND status = 'OPEN'",
    )
      .bind(unpricedTable1Id)
      .first<{ id: string; version: number }>();
    expect(order).not.toBeNull();

    const sourceFree = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable1Id)
      .first<{ version: number }>();
    const targetFree = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable4Id)
      .first<{ version: number }>();

    await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-unpriced-history-to-unpriced',
      idempotencyKey: 'cmd-transfer-unpriced-history-to-unpriced',
      orderId: order!.id,
      targetTableId: unpricedTable4Id,
      expectedOrderVersion: order!.version,
      expectedSourceTableVersion: sourceFree!.version,
      expectedTargetTableVersion: targetFree!.version,
      now: movedBetweenFreeTablesAt,
    });

    const endedAfterFreeTransfer = await env.DB.prepare(
      'SELECT status, ended_at FROM time_sessions WHERE order_id = ?',
    )
      .bind(order!.id)
      .first<{ status: string; ended_at: number }>();
    expect(endedAfterFreeTransfer).toEqual({
      status: 'ENDED',
      ended_at: new Date('2026-09-01T15:00:00+07:00').getTime(),
    });

    const orderOnSecondFreeTable = await env.DB.prepare('SELECT version FROM orders WHERE id = ?')
      .bind(order!.id)
      .first<{ version: number }>();
    const secondFree = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable4Id)
      .first<{ version: number }>();
    const priced = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(pricedTable3Id)
      .first<{ version: number }>();

    await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-unpriced-history-to-priced',
      idempotencyKey: 'cmd-transfer-unpriced-history-to-priced',
      orderId: order!.id,
      targetTableId: pricedTable3Id,
      expectedOrderVersion: orderOnSecondFreeTable!.version,
      expectedSourceTableVersion: secondFree!.version,
      expectedTargetTableVersion: priced!.version,
      now: returnedToPricedAt,
    });

    const quote = await pos.quote(storeId, order!.id, quotedAt);
    expect(quote.time?.status).toBe('RUNNING');
    expect(quote.time?.tableSegments).toHaveLength(2);
    expect(quote.time?.tableSegments?.[0]?.endedAtMs).toBe(
      new Date('2026-09-01T15:00:00+07:00').getTime(),
    );
    expect(quote.time?.tableSegments?.[1]?.startedAtMs).toBe(returnedToPricedAt);
    expect(quote.time?.amountAfterRoundingVnd).toBe(120_000);

    // Release the priced table for the independent compatibility check below.
    const currentOrder = await env.DB.prepare('SELECT version FROM orders WHERE id = ?')
      .bind(order!.id)
      .first<{ version: number }>();
    const currentPriced = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(pricedTable3Id)
      .first<{ version: number }>();
    const freeTarget = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(unpricedTable1Id)
      .first<{ version: number }>();
    await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-release-priced-after-gap-test',
      idempotencyKey: 'cmd-release-priced-after-gap-test',
      orderId: order!.id,
      targetTableId: unpricedTable1Id,
      expectedOrderVersion: currentOrder!.version,
      expectedSourceTableVersion: currentPriced!.version,
      expectedTargetTableVersion: freeTarget!.version,
      now: new Date('2026-09-01T18:00:00+07:00').getTime(),
    });
  });

  it('priced tables continue to function with full hourly billing', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-09-01T16:00:00+07:00').getTime();

    // Table 3 is available now
    const tableBeforeOpen = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(pricedTable3Id)
      .first<{ version: number }>();
    const openRes = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-open-priced-3',
      idempotencyKey: 'cmd-open-priced-3',
      tableId: pricedTable3Id,
      expectedTableVersion: tableBeforeOpen!.version,
      now: t0,
    });

    expect(openRes.orderId).toBeDefined();

    // Session exists and is RUNNING
    const session = await env.DB.prepare(
      "SELECT id, status, pricing_version FROM time_sessions WHERE order_id = ? AND status = 'RUNNING'",
    )
      .bind(openRes.orderId)
      .first<{ id: string; status: string; pricing_version: number }>();
    expect(session).not.toBeNull();
    expect(session?.pricing_version).toBe(1);

    // Quote after 2 hours (120 minutes = 120,000 VND)
    const quote = await pos.quote(storeId, openRes.orderId, t0 + 7200_000);
    expect(quote.time).not.toBeNull();
    expect(quote.time?.amountAfterRoundingVnd).toBe(120_000);
  });
});
