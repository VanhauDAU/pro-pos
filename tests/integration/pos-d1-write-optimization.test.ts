import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';

describe('POS Cloudflare D1 Rows Written & Write Optimization', () => {
  let storeId: string;
  let ownerUserId: string;
  let areaId: string;
  let timeProductId: string;
  let productIds: string[] = [];
  let variantIds: (string | null)[] = [];
  let tableIndex = 0;

  async function createTestTable() {
    tableIndex += 1;
    const catalog = new CatalogService(env);
    const table = await catalog.createTable({
      storeId,
      areaId,
      timeProductId,
      name: `Bàn Test ${tableIndex}`,
      sortOrder: tableIndex,
    });
    return table.id;
  }

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.opt@example.com',
      displayName: 'System Optimization',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'Optimization Store',
      ownerDisplayName: 'Opt Owner',
      ownerEmail: 'opt.owner@example.com',
    }));

    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(storeId, 'areas', 'Khu VIP');
    areaId = area.id;
    const existingUnits = (await catalog.listNamed(storeId, 'units')).results;
    const unit = existingUnits[0]!;

    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ Bida',
      productType: 'TIME',
      variants: [],
    });
    timeProductId = timeProduct.id;
    await catalog.upsertPricing(storeId, {
      productId: timeProduct.id,
      basePriceVnd: 50_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });

    for (let i = 1; i <= 6; i++) {
      const prod = await catalog.createProduct(storeId, {
        name: `Sản phẩm ${i}`,
        productType: 'QUANTITY',
        unitId: unit.id,
        variants: [
          {
            name: `Giá ${i}`,
            salePriceVnd: 10_000 * i,
            costPriceVnd: 5_000 * i,
            promptPrice: false,
          },
        ],
      });
      productIds.push(prod.id);
      const detail = await catalog.getProduct(storeId, prod.id);
      const firstVariant = detail?.variants[0] as { id: string } | undefined;
      variantIds.push(firstVariant?.id ?? null);
    }
  });

  // CASE 1: Standalone update retains discrete audit
  it('1. Standalone item update produces discrete ORDER_ITEM_UPDATED audit log', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-c1-open',
      idempotencyKey: 'cmd-c1-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const item = opened.items[0]!;

    const updated = await pos.updateItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-c1-standalone-update',
      idempotencyKey: 'cmd-c1-standalone-update',
      orderId: opened.order.id,
      itemId: item.id,
      expectedOrderVersion: opened.order.version,
      quantityMilli: 3_000,
      note: 'Ghi chú standalone',
    });

    expect(updated.order.version).toBe(opened.order.version + 1);

    const auditRows = await env.DB.prepare(
      `SELECT action, entity_type, entity_id FROM audit_logs WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-c1-standalone-update')
      .all<{ action: string; entity_type: string; entity_id: string }>();

    expect(auditRows.results).toHaveLength(1);
    expect(auditRows.results[0]!.action).toBe('ORDER_ITEM_UPDATED');
    expect(auditRows.results[0]!.entity_type).toBe('ORDER_ITEM');
    expect(auditRows.results[0]!.entity_id).toBe(item.id);
  });

  // CASE 2 & 3 & 4: Batch update suppresses discrete audit, executes business mutation & version bump, and ends with exactly one ORDER_BATCH_SAVED
  it('2, 3, 4. Batch Save suppresses discrete audits, executes business mutations & version bump, and produces exactly one ORDER_BATCH_SAVED audit log', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-c234-open',
      idempotencyKey: 'cmd-c234-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: 'Món 1',
            discount: null,
          },
          {
            productId: productIds[1]!,
            variantId: variantIds[1] ?? null,
            quantityMilli: 1_000,
            note: 'Món 2',
            discount: null,
          },
        ],
      },
    });

    const item1 = opened.items.find((i) => i.productId === productIds[0]!)!;
    const item2 = opened.items.find((i) => i.productId === productIds[1]!)!;

    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-c234-batch-save',
      idempotencyKey: 'cmd-c234-batch-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productIds[2]!,
            variantId: variantIds[2] ?? null,
            quantityMilli: 1_000,
            note: 'Món 3 thêm mới',
            discount: null,
          },
        ],
        updatedItems: [
          {
            itemId: item1.id,
            quantityMilli: 2_000,
            note: 'Món 1 đổi ghi chú',
            discount: null,
          },
          {
            itemId: item2.id,
            quantityMilli: 1_000,
            note: 'Món 2',
            discount: null,
          },
        ],
      },
    });

    // 3. Business mutation & order version verified
    expect(saved.order.version).toBe(opened.order.version + 2); // 1 item updated + 1 item added
    const dbItem1 = await env.DB.prepare(
      `SELECT quantity_milli, note FROM order_items WHERE store_id = ? AND id = ?`,
    )
      .bind(storeId, item1.id)
      .first<{ quantity_milli: number; note: string }>();
    expect(dbItem1?.quantity_milli).toBe(2_000);
    expect(dbItem1?.note).toBe('Món 1 đổi ghi chú');

    // 2 & 4. Discrete trigger audit suppressed, exactly 1 ORDER_BATCH_SAVED audit row written
    const auditRows = await env.DB.prepare(
      `SELECT action, entity_type, entity_id FROM audit_logs WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-c234-batch-save')
      .all<{ action: string; entity_type: string; entity_id: string }>();

    expect(auditRows.results.filter((r) => r.action === 'ORDER_ITEM_UPDATED')).toHaveLength(0);
    expect(auditRows.results.filter((r) => r.action === 'ORDER_BATCH_SAVED')).toHaveLength(1);
    expect(auditRows.results).toHaveLength(1);
    expect(auditRows.results[0]!.entity_type).toBe('ORDER');
    expect(auditRows.results[0]!.entity_id).toBe(opened.order.id);
  });

  it('suppresses discrete trigger audit rows in batch open and creates exactly one ORDER_BATCH_SAVED audit log for 6 items', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-batch-open-audit-001',
      idempotencyKey: 'cmd-batch-open-audit-001',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: productIds.map((id, index) => ({
          productId: id,
          variantId: variantIds[index] ?? null,
          quantityMilli: 1_000,
          note: null,
          discount: null,
        })),
      },
    });

    expect(opened.items).toHaveLength(6);
    expect(opened.order.status).toBe('OPEN');

    const auditRows = await env.DB.prepare(
      `SELECT action, entity_type, entity_id FROM audit_logs WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-batch-open-audit-001')
      .all<{ action: string; entity_type: string; entity_id: string }>();

    expect(auditRows.results).toHaveLength(1);
    expect(auditRows.results[0]!.action).toBe('ORDER_BATCH_SAVED');
    expect(auditRows.results[0]!.entity_type).toBe('ORDER');
    expect(auditRows.results[0]!.entity_id).toBe(opened.order.id);
  });

  it('performs item-level no-op filtering and skips statement generation for unchanged items in batch save', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-item-noop-open',
      idempotencyKey: 'cmd-item-noop-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: 'Món 1',
            discount: null,
          },
          {
            productId: productIds[1]!,
            variantId: variantIds[1] ?? null,
            quantityMilli: 1_000,
            note: 'Món 2',
            discount: null,
          },
          {
            productId: productIds[2]!,
            variantId: variantIds[2] ?? null,
            quantityMilli: 1_000,
            note: 'Món 3',
            discount: null,
          },
        ],
      },
    });

    const item1 = opened.items.find((i) => i.productId === productIds[0]!)!;
    const item2 = opened.items.find((i) => i.productId === productIds[1]!)!;
    const item3 = opened.items.find((i) => i.productId === productIds[2]!)!;

    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-item-noop-save',
      idempotencyKey: 'cmd-item-noop-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [],
        updatedItems: [
          {
            itemId: item1.id,
            quantityMilli: 2_000,
            note: 'Món 1',
            discount: null,
          },
          {
            itemId: item2.id,
            quantityMilli: 1_000,
            note: 'Món 2',
            discount: null,
          },
          {
            itemId: item3.id,
            quantityMilli: 1_000,
            note: 'Món 3',
            discount: null,
          },
        ],
      },
    });

    expect(saved.order.version).toBe(opened.order.version + 1);

    const dbItem1 = await env.DB.prepare(
      `SELECT quantity_milli FROM order_items WHERE store_id = ? AND id = ?`,
    )
      .bind(storeId, item1.id)
      .first<{ quantity_milli: number }>();
    expect(dbItem1?.quantity_milli).toBe(2_000);

    const auditRows = await env.DB.prepare(
      `SELECT action FROM audit_logs WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-item-noop-save')
      .all<{ action: string }>();

    expect(auditRows.results.filter((r) => r.action === 'ORDER_ITEM_UPDATED')).toHaveLength(0);
    expect(auditRows.results.filter((r) => r.action === 'ORDER_BATCH_SAVED')).toHaveLength(1);
    expect(auditRows.results).toHaveLength(1);

    const callBatches = await pos.listOrderCallBatches(storeId, opened.order.id);
    const latestBatch = callBatches.items.find((b) => b.sequenceNo === 2) ?? callBatches.items[0]!;
    expect(latestBatch.entries).toHaveLength(1);
    expect(latestBatch.entries[0]!.itemId).toBe(item1.id);
    expect(latestBatch.entries[0]!.deltaQuantityMilli).toBe(1_000);
  });

  it('handles full no-op save without version increment, realtime context, or audit rows', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-full-noop-open',
      idempotencyKey: 'cmd-full-noop-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        note: 'Ghi chú bàn',
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: 'Ít đường',
            discount: null,
          },
        ],
      },
    });

    const item = opened.items[0]!;
    const initialVersion = opened.order.version;

    const noopResult = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-full-noop-save',
      idempotencyKey: 'cmd-full-noop-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: initialVersion,
        nextAction: 'STAY',
        note: 'Ghi chú bàn',
        addedItems: [],
        updatedItems: [
          {
            itemId: item.id,
            quantityMilli: 1_000,
            note: 'Ít đường',
            discount: null,
          },
        ],
      },
    });

    expect(noopResult.order.version).toBe(initialVersion);

    const auditRows = await env.DB.prepare(
      `SELECT action FROM audit_logs WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-full-noop-save')
      .all();
    expect(auditRows.results).toHaveLength(0);

    const realtimeEvents = await env.DB.prepare(
      `SELECT event_id FROM realtime_events WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-full-noop-save')
      .all();
    expect(realtimeEvents.results).toHaveLength(0);

    const cached = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-full-noop-replay',
      idempotencyKey: 'cmd-full-noop-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: initialVersion,
        nextAction: 'STAY',
        note: 'Ghi chú bàn',
        addedItems: [],
        updatedItems: [
          {
            itemId: item.id,
            quantityMilli: 1_000,
            note: 'Ít đường',
            discount: null,
          },
        ],
      },
    });

    expect(cached.order.version).toBe(initialVersion);
    expect(cached.order.id).toBe(opened.order.id);
  });

  it('correctly detects clearing note, discount reason, and customer while avoiding updates when unchanged', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-clear-open',
      idempotencyKey: 'cmd-clear-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        note: 'Ghi chú ban đầu',
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: 'Món ban đầu',
            discount: {
              type: 'PERCENT',
              value: 10,
              reason: 'Khách VIP',
            },
          },
        ],
      },
    });

    const item = opened.items[0]!;
    expect(opened.order.note).toBe('Ghi chú ban đầu');
    expect(item.discountReason).toBe('Khách VIP');

    const clearedNote = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-clear-note-save',
      idempotencyKey: 'cmd-clear-note-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        note: '',
        addedItems: [],
        updatedItems: [
          {
            itemId: item.id,
            quantityMilli: 1_000,
            note: 'Món ban đầu',
            discount: {
              type: 'PERCENT',
              value: 10,
              reason: 'Khách VIP',
            },
          },
        ],
      },
    });

    expect(clearedNote.order.note).toBeNull();
    expect(clearedNote.order.version).toBe(opened.order.version + 1);

    const clearedDiscountReason = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-clear-discount-save',
      idempotencyKey: 'cmd-clear-discount-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: clearedNote.order.version,
        nextAction: 'STAY',
        addedItems: [],
        updatedItems: [
          {
            itemId: item.id,
            quantityMilli: 1_000,
            note: 'Món ban đầu',
            discount: {
              type: 'PERCENT',
              value: 10,
              reason: '',
            },
          },
        ],
      },
    });

    const updatedItem = clearedDiscountReason.items.find((i) => i.id === item.id)!;
    expect(updatedItem.discountReason).toBeNull();
    expect(clearedDiscountReason.order.version).toBe(clearedNote.order.version + 1);
  });

  it('eliminates empty call history batches on zero-item open table and sets sequence 1 on first addition', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-zero-open',
      idempotencyKey: 'cmd-zero-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [],
      },
    });

    const batchesAfterOpen = await pos.listOrderCallBatches(storeId, opened.order.id);
    expect(batchesAfterOpen.items).toHaveLength(0);

    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-first-item-save',
      idempotencyKey: 'cmd-first-item-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 2_000,
            note: 'Thêm món lần 1',
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    expect(saved.callBatch).toBeDefined();
    expect(saved.callBatch?.sequenceNo).toBe(1);

    const batchesAfterSave = await pos.listOrderCallBatches(storeId, opened.order.id);
    expect(batchesAfterSave.items).toHaveLength(1);
    expect(batchesAfterSave.items[0]!.sequenceNo).toBe(1);
  });

  it('preserves duplicate item merging from migration 0056 across trigger refactoring', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-merge-open',
      idempotencyKey: 'cmd-merge-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: 'Merge test',
            discount: null,
          },
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 2_000,
            note: 'Merge test',
            discount: null,
          },
        ],
      },
    });

    const itemRows = await env.DB.prepare(
      `SELECT id, quantity_milli FROM order_items WHERE store_id = ? AND order_id = ?`,
    )
      .bind(storeId, opened.order.id)
      .all<{ id: string; quantity_milli: number }>();

    expect(itemRows.results).toHaveLength(1);
    expect(itemRows.results[0]!.quantity_milli).toBe(3_000);
  });

  it('completely rolls back database changes and leaves zero orphan batch contexts on mid-batch failure', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable();
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-rollback-open',
      idempotencyKey: 'cmd-rollback-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productIds[0]!,
            variantId: variantIds[0] ?? null,
            quantityMilli: 1_000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    await expect(
      pos.saveOrderCommand({
        storeId,
        actorId: ownerUserId,
        requestId: 'req-rollback-fail',
        idempotencyKey: 'cmd-rollback-fail',
        orderId: opened.order.id,
        values: {
          expectedOrderVersion: 999,
          nextAction: 'STAY',
          addedItems: [
            {
              productId: productIds[0]!,
              variantId: variantIds[0] ?? null,
              quantityMilli: 5_000,
              note: null,
              discount: null,
            },
          ],
          updatedItems: [],
        },
      }),
    ).rejects.toThrow();

    const batchContexts = await env.DB.prepare(
      `SELECT command_id FROM realtime_batch_contexts WHERE store_id = ?`,
    )
      .bind(storeId)
      .all();
    expect(batchContexts.results).toHaveLength(0);

    const currentQuote = await pos.quote(storeId, opened.order.id);
    expect(currentQuote.order.version).toBe(opened.order.version);
    expect(currentQuote.items).toHaveLength(1);
  });
});
