import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import {
  PosService,
  compactSaveSnapshot,
  parseStoredSaveReplay,
} from '@server/services/pos-service';
import { PromotionService } from '@server/services/promotion-service';
import { AppError } from '@server/lib/app-error';

describe('POS Save Order P0 Optimization & Correctness', () => {
  let storeId: string;
  let ownerUserId: string;
  let areaId: string;
  let timeProductId: string;
  let productAId: string;
  let variantAId: string | null = null;
  let productBId: string;
  let variantBId: string | null = null;
  let giftProductId: string;
  let giftVariantId: string | null = null;
  let tableIndex = 0;

  async function createTestTable(withTime = true) {
    tableIndex += 1;
    const catalog = new CatalogService(env);
    const table = await catalog.createTable({
      storeId,
      areaId,
      timeProductId: withTime ? timeProductId : null,
      name: `Bàn P0 Test ${tableIndex}`,
      sortOrder: tableIndex,
    });
    return table.id;
  }

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'p0.admin@example.com',
      displayName: 'P0 Admin',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'P0 Save Opt Store',
      ownerDisplayName: 'P0 Owner',
      ownerEmail: 'p0.owner@example.com',
    }));

    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(storeId, 'areas', 'Khu P0');
    areaId = area.id;
    const units = (await catalog.listNamed(storeId, 'units')).results;
    const unit = units[0]!;

    // Time product
    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ Bida P0',
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

    // Product A (Coca 20k)
    const prodA = await catalog.createProduct(storeId, {
      name: 'Coca Cola P0',
      productType: 'QUANTITY',
      unitId: unit.id,
      variants: [{ name: 'Lon', salePriceVnd: 20_000, costPriceVnd: 10_000, promptPrice: false }],
    });
    productAId = prodA.id;
    const detailA = await catalog.getProduct(storeId, prodA.id);
    variantAId = (detailA?.variants[0] as { id: string } | undefined)?.id ?? null;

    // Product B (Mì Xào 50k)
    const prodB = await catalog.createProduct(storeId, {
      name: 'Mì Xào Bò P0',
      productType: 'QUANTITY',
      unitId: unit.id,
      variants: [{ name: 'Đĩa', salePriceVnd: 50_000, costPriceVnd: 25_000, promptPrice: false }],
    });
    productBId = prodB.id;
    const detailB = await catalog.getProduct(storeId, prodB.id);
    variantBId = (detailB?.variants[0] as { id: string } | undefined)?.id ?? null;

    // Gift Product (Snack)
    const prodGift = await catalog.createProduct(storeId, {
      name: 'Snack Quà Tặng P0',
      productType: 'QUANTITY',
      unitId: unit.id,
      variants: [{ name: 'Gói', salePriceVnd: 15_000, costPriceVnd: 7_000, promptPrice: false }],
    });
    giftProductId = prodGift.id;
    const detailGift = await catalog.getProduct(storeId, prodGift.id);
    giftVariantId = (detailGift?.variants[0] as { id: string } | undefined)?.id ?? null;
  });

  // TEST 1: STAY save không dùng FULL-only data (0 FULL quote, 1 EDITOR quote, không cần bank account)
  it('Test 1: SAVE + STAY uses 0 FULL quotes, exactly 1 EDITOR quote, and does not require bank accounts', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t1-open',
      idempotencyKey: 'cmd-t1-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const quoteSpy = vi.spyOn(pos, 'quote');

    try {
      const saved = await pos.saveOrderCommand({
        storeId,
        actorId: ownerUserId,
        requestId: 'req-t1-save',
        idempotencyKey: 'cmd-t1-save',
        orderId: opened.order.id,
        values: {
          expectedOrderVersion: opened.order.version,
          nextAction: 'STAY',
          addedItems: [
            {
              productId: productBId,
              variantId: variantBId,
              quantityMilli: 1000,
              note: null,
              discount: null,
            },
          ],
          updatedItems: [],
        },
      });

      // Verify projection and quote call counts
      const fullQuoteCalls = quoteSpy.mock.calls.filter(
        (call) => !call[3]?.projection || call[3]?.projection === 'FULL',
      );
      const editorQuoteCalls = quoteSpy.mock.calls.filter(
        (call) => call[3]?.projection === 'EDITOR',
      );

      expect(fullQuoteCalls).toHaveLength(0);
      expect(editorQuoteCalls).toHaveLength(1);

      // Verify response structure
      expect(saved.order.id).toBe(opened.order.id);
      expect(saved.order.version).toBe(opened.order.version + 1);
      expect(saved.quote.items).toHaveLength(2);
      expect('bankAccounts' in saved.quote).toBe(false);
      expect('bankSettings' in saved.quote).toBe(false);
      expect(saved.totals.totalVnd).toBe(70_000);
    } finally {
      quoteSpy.mockRestore();
    }
  });

  // TEST 2: Optimistic concurrency conflict (client B gets 409 ORDER_VERSION_CONFLICT with canonical EDITOR quote, no DB mutation)
  it('Test 2: Concurrency conflict returns 409 ORDER_VERSION_CONFLICT with canonical EDITOR quote and no DB mutation', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t2-open',
      idempotencyKey: 'cmd-t2-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const versionN = opened.order.version;

    // Client A saves successfully
    const saveA = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t2-save-a',
      idempotencyKey: 'cmd-t2-save-a',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: versionN,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });
    expect(saveA.order.version).toBe(versionN + 1);

    // Client B tries to save with stale version N
    let conflictError: AppError | null = null;
    try {
      await pos.saveOrderCommand({
        storeId,
        actorId: ownerUserId,
        requestId: 'req-t2-save-b',
        idempotencyKey: 'cmd-t2-save-b',
        orderId: opened.order.id,
        values: {
          expectedOrderVersion: versionN,
          nextAction: 'STAY',
          addedItems: [
            {
              productId: productBId,
              variantId: variantBId,
              quantityMilli: 1000,
              note: null,
              discount: null,
            },
          ],
          updatedItems: [],
        },
      });
    } catch (err) {
      if (err instanceof AppError) conflictError = err;
    }

    expect(conflictError).not.toBeNull();
    expect(conflictError!.code).toBe('ORDER_VERSION_CONFLICT');
    expect(conflictError!.status).toBe(409);
    const details = conflictError!.details as { quote?: { order: { version: number } } };
    expect(details?.quote?.order.version).toBe(versionN + 1);

    // Verify no DB mutations from Client B
    const latest = await pos.quote(storeId, opened.order.id, Date.now(), { projection: 'EDITOR' });
    expect(latest.order.version).toBe(versionN + 1);
    expect(latest.items.some((i) => i.productId === productBId)).toBe(false);
  });

  // TEST 3: Idempotency replay (no double version, no double items, no double audit, no double realtime, does not rebuild quote)
  it('Test 3: Idempotency replay returns cached result without incrementing version or repeating audit/realtime/quote', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t3-open',
      idempotencyKey: 'cmd-t3-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [],
      },
    });

    const commandId = 'cmd-t3-idempotent-save';
    const payload = {
      expectedOrderVersion: opened.order.version,
      nextAction: 'STAY' as const,
      addedItems: [
        {
          productId: productAId,
          variantId: variantAId,
          quantityMilli: 2000,
          note: 'Coca x2',
          discount: null,
        },
      ],
      updatedItems: [],
    };

    // Call 1 -> commit
    const firstCall = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t3-call-1',
      idempotencyKey: commandId,
      orderId: opened.order.id,
      values: payload,
    });

    expect(firstCall.order.version).toBe(opened.order.version + 1);

    // Spy on quote to verify replay does NOT rebuild latest quote
    const quoteSpy = vi.spyOn(pos, 'quote');

    try {
      // Call 2 -> replay
      const secondCall = await pos.saveOrderCommand({
        storeId,
        actorId: ownerUserId,
        requestId: 'req-t3-call-2',
        idempotencyKey: commandId,
        orderId: opened.order.id,
        values: payload,
      });

      expect(quoteSpy).not.toHaveBeenCalled();
      expect(secondCall.order.version).toBe(firstCall.order.version);
      expect(secondCall.order.id).toBe(firstCall.order.id);
      expect(secondCall.totals.totalVnd).toBe(firstCall.totals.totalVnd);
      expect(secondCall.items).toHaveLength(1);
      expect(secondCall.items[0]!.quantityMilli).toBe(2000);

      // Verify exactly one audit log created for the command
      const auditRows = await env.DB.prepare(
        `SELECT id, action FROM audit_logs WHERE store_id = ? AND request_id IN (?, ?)`,
      )
        .bind(storeId, 'req-t3-call-1', 'req-t3-call-2')
        .all();
      expect(auditRows.results).toHaveLength(1);
      expect(auditRows.results[0]!.action).toBe('ORDER_BATCH_SAVED');
    } finally {
      quoteSpy.mockRestore();
    }
  });

  // TEST 4: Idempotency payload mismatch returns 409 IDEMPOTENCY_PAYLOAD_MISMATCH
  it('Test 4: Same Idempotency-Key with different payload throws 409 IDEMPOTENCY_PAYLOAD_MISMATCH', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t4-open',
      idempotencyKey: 'cmd-t4-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [],
      },
    });

    const commandId = 'cmd-t4-mismatch';

    await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t4-call-1',
      idempotencyKey: commandId,
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    let mismatchError: AppError | null = null;
    try {
      await pos.saveOrderCommand({
        storeId,
        actorId: ownerUserId,
        requestId: 'req-t4-call-2',
        idempotencyKey: commandId,
        orderId: opened.order.id,
        values: {
          expectedOrderVersion: opened.order.version,
          nextAction: 'STAY',
          addedItems: [
            {
              productId: productBId,
              variantId: variantBId,
              quantityMilli: 1000,
              note: null,
              discount: null,
            },
          ],
          updatedItems: [],
        },
      });
    } catch (err) {
      if (err instanceof AppError) mismatchError = err;
    }

    expect(mismatchError).not.toBeNull();
    expect(mismatchError!.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(mismatchError!.status).toBe(409);
  });

  // TEST 5: Compact replay format, byte comparison, and backward compatibility
  it('Test 5: Stored compact JSON bytes < public snapshot JSON bytes and deserializer supports legacy format', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t5-open',
      idempotencyKey: 'cmd-t5-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t5-save',
      idempotencyKey: 'cmd-t5-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productBId,
            variantId: variantBId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    // Check compact JSON in database
    const row = await env.DB.prepare(
      `SELECT response_json FROM pos_save_commands WHERE store_id = ? AND id = ?`,
    )
      .bind(storeId, 'cmd-t5-save')
      .first<{ response_json: string }>();

    expect(row?.response_json).toBeTruthy();
    const parsedStored = JSON.parse(row!.response_json);
    expect(parsedStored.v).toBe(1);
    expect('order' in parsedStored).toBe(false);
    expect('items' in parsedStored).toBe(false);
    expect('totals' in parsedStored).toBe(false);

    // Verify compactSaveSnapshot helper produces identical compact representation
    const locallyCompacted = compactSaveSnapshot(saved);
    expect(locallyCompacted.v).toBe(1);
    expect(JSON.stringify(locallyCompacted)).toBe(row!.response_json);

    // Byte length comparison
    const compactBytes = new TextEncoder().encode(row!.response_json).byteLength;
    const publicBytes = new TextEncoder().encode(JSON.stringify(saved)).byteLength;
    expect(compactBytes).toBeLessThan(publicBytes);

    // Test hydration from V1
    const hydratedV1 = parseStoredSaveReplay(row!.response_json);
    expect(hydratedV1.clientMutationId).toBe(saved.clientMutationId);
    expect(hydratedV1.order.id).toBe(saved.order.id);
    expect(hydratedV1.items).toHaveLength(saved.items.length);
    expect(hydratedV1.totals.totalVnd).toBe(saved.totals.totalVnd);

    // Test legacy format backward compatibility
    const legacySnapshotJson = JSON.stringify({
      clientMutationId: 'cmd-legacy-test',
      quote: saved.quote,
      order: saved.order,
      items: saved.items,
      totals: saved.totals,
      tableSummaries: saved.tableSummaries,
      orderVersion: saved.orderVersion,
      serverNowMs: saved.serverNowMs,
    });
    const hydratedLegacy = parseStoredSaveReplay(legacySnapshotJson);
    expect(hydratedLegacy.clientMutationId).toBe('cmd-legacy-test');
    expect(hydratedLegacy.order.id).toBe(saved.order.id);
    expect(hydratedLegacy.totals.totalVnd).toBe(saved.totals.totalVnd);
  });

  // TEST 6: Promotion recalculation when adding items crosses threshold
  it('Test 6: Adding items crosses promotion subtotal threshold and post-save quote accurately applies promotion', async () => {
    // Create promotion: 20k off when order subtotal >= 100k
    const promo = await new PromotionService(env).save(storeId, ownerUserId, {
      name: 'Tự động giảm 20k đơn từ 100k',
      type: 'FIXED_AMOUNT',
      value: 20_000,
      minimumOrderVnd: 100_000,
      maximumDiscountVnd: null,
      autoApply: true,
      startsAt: Date.now() - 10_000,
      endsAt: null,
      weekdaysMask: null,
      timeRanges: [],
      scope: 'INVOICE',
      categoryIds: [],
      productIds: [],
      productTargets: [],
      customerGroupIds: [],
      giftProductIds: [],
      giftTargets: [],
      giftBuyAny: false,
      maximumGiftQuantity: null,
    });

    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    // Initial order: 1 Mì Xào = 50k (under 100k threshold)
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t6-open',
      idempotencyKey: 'cmd-t6-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productBId,
            variantId: variantBId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });
    expect(opened.totals.totalVnd).toBe(50_000);
    expect(opened.quote.promotions).toHaveLength(0);

    // Save order: add 1 Mì Xào (50k) -> subtotal becomes 100k -> qualifies for 20k discount
    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t6-save',
      idempotencyKey: 'cmd-t6-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productBId,
            variantId: variantBId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    expect(saved.totals.subtotalVnd).toBe(100_000);
    expect(saved.totals.discountTotalVnd).toBe(20_000);
    expect(saved.totals.totalVnd).toBe(80_000);
    expect(saved.quote.promotions.some((p) => p.id === promo.id)).toBe(true);
  });

  // TEST 7: Table time pricing is preserved and calculated accurately on DINE_IN order
  it('Test 7: DINE_IN with active time session preserves time amount, subtotal and total after save', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(true);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t7-open',
      idempotencyKey: 'cmd-t7-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    expect(opened.quote.time).toBeTruthy();

    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t7-save',
      idempotencyKey: 'cmd-t7-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productBId,
            variantId: variantBId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    expect(saved.quote.time).toBeTruthy();
    expect(saved.quote.time?.status).toBe('RUNNING');
    expect(saved.totals.subtotalVnd).toBeGreaterThanOrEqual(70_000);
    expect(saved.totals.totalVnd).toBe(saved.totals.subtotalVnd - saved.totals.discountTotalVnd);
  });

  // TEST 8: No-op save does not bump version, no business audit, no business realtime
  it('Test 8: No-op save does not increment version, produces no business audit, and emits no business realtime', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t8-open',
      idempotencyKey: 'cmd-t8-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        note: 'Ban dau',
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const initialVersion = opened.order.version;

    const noopResult = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t8-noop-save',
      idempotencyKey: 'cmd-t8-noop-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: initialVersion,
        nextAction: 'STAY',
        note: 'Ban dau',
        addedItems: [],
        updatedItems: [],
      },
    });

    expect(noopResult.order.version).toBe(initialVersion);

    // Verify no ORDER_BATCH_SAVED audit was created
    const auditRows = await env.DB.prepare(
      `SELECT id FROM audit_logs WHERE store_id = ? AND request_id = ? AND action = 'ORDER_BATCH_SAVED'`,
    )
      .bind(storeId, 'req-t8-noop-save')
      .all();
    expect(auditRows.results).toHaveLength(0);

    // Verify no realtime events emitted
    const realtimeEvents = await env.DB.prepare(
      `SELECT event_id FROM realtime_events WHERE store_id = ? AND request_id = ?`,
    )
      .bind(storeId, 'req-t8-noop-save')
      .all();
    expect(realtimeEvents.results).toHaveLength(0);
  });

  // TEST 9: Item merge combines lines without duplicates and records accurate call batch history
  it('Test 9: Item merge combines quantity into existing line and records before/delta/after in call batch', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t9-open',
      idempotencyKey: 'cmd-t9-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    // Save adding 2 more of the exact same product A
    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t9-save-merge',
      idempotencyKey: 'cmd-t9-save-merge',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 2000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    // Verify exactly 1 line item exists with combined quantity of 3000
    expect(saved.quote.items).toHaveLength(1);
    expect(saved.quote.items[0]!.quantityMilli).toBe(3000);
    expect(saved.totals.totalVnd).toBe(60_000);

    // Verify call batch history
    expect(saved.callBatch).toBeTruthy();
    expect(saved.callBatch!.entries).toHaveLength(1);
    const entry = saved.callBatch!.entries[0]!;
    expect(entry.beforeQuantityMilli).toBe(1000);
    expect(entry.deltaQuantityMilli).toBe(2000);
    expect(entry.afterQuantityMilli).toBe(3000);
    expect(entry.changeType).toBe('ADJUST');
  });

  // TEST 10: Checkout continuation (BEGIN_CHECKOUT stops time and creates payment snapshot)
  it('Test 10: save with BEGIN_CHECKOUT stops time and generates paymentSnapshot with payment details', async () => {
    const pos = new PosService(env);
    const tableId = await createTestTable(true);

    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t10-open',
      idempotencyKey: 'cmd-t10-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const checkoutSaved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t10-save-checkout',
      idempotencyKey: 'cmd-t10-save-checkout',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'BEGIN_CHECKOUT',
        addedItems: [
          {
            productId: productBId,
            variantId: variantBId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    expect('paymentSnapshot' in checkoutSaved).toBe(true);
    if ('paymentSnapshot' in checkoutSaved) {
      expect(checkoutSaved.paymentSnapshot).toBeTruthy();
    }
    expect(checkoutSaved.order.status).toBe('PAYMENT_PENDING');
    expect(checkoutSaved.quote.time?.status).toBe('ENDED');
  });

  // TEST 11: Promotion gift items semantics are preserved when saving additional items
  it('Test 11: Promotion gift items are accurately preserved and recalculated after save', async () => {
    // Promotion: Buy Coca, get Snack free
    await new PromotionService(env).save(storeId, ownerUserId, {
      name: 'Tặng Snack khi mua Coca',
      type: 'GIFT',
      value: 0,
      minimumOrderVnd: 0,
      maximumDiscountVnd: null,
      autoApply: true,
      startsAt: Date.now() - 10_000,
      endsAt: null,
      weekdaysMask: null,
      timeRanges: [],
      scope: 'PRODUCT',
      categoryIds: [],
      productIds: [],
      productTargets: [{ productId: productAId, variantId: variantAId, quantity: 1 }],
      customerGroupIds: [],
      giftProductIds: [],
      giftTargets: [{ productId: giftProductId, variantId: giftVariantId, quantity: 1 }],
      giftBuyAny: false,
      maximumGiftQuantity: 1,
    });

    const pos = new PosService(env);
    const tableId = await createTestTable(false);

    // Open order with Coca -> automatically gets gift item Snack
    const opened = await pos.openOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t11-open',
      idempotencyKey: 'cmd-t11-open',
      values: {
        orderType: 'DINE_IN',
        tableId,
        expectedTableVersion: 1,
        items: [
          {
            productId: productAId,
            variantId: variantAId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
      },
    });

    const giftInOpened = opened.quote.items.find((i) => 'promotionGift' in i && i.promotionGift);
    expect(giftInOpened).toBeTruthy();
    expect(giftInOpened!.productId).toBe(giftProductId);

    // Save order adding Mì Xào -> pre-save lightweight state does not corrupt gift, post-save quote still has gift
    const saved = await pos.saveOrderCommand({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-t11-save',
      idempotencyKey: 'cmd-t11-save',
      orderId: opened.order.id,
      values: {
        expectedOrderVersion: opened.order.version,
        nextAction: 'STAY',
        addedItems: [
          {
            productId: productBId,
            variantId: variantBId,
            quantityMilli: 1000,
            note: null,
            discount: null,
          },
        ],
        updatedItems: [],
      },
    });

    const regularItems = saved.quote.items.filter(
      (i) => !('promotionGift' in i && i.promotionGift),
    );
    const giftItems = saved.quote.items.filter((i) => 'promotionGift' in i && i.promotionGift);

    expect(regularItems).toHaveLength(2); // Coca + Mì Xào
    expect(giftItems).toHaveLength(1); // Snack
    expect(giftItems[0]!.productId).toBe(giftProductId);
    expect(saved.totals.totalVnd).toBe(70_000); // 20k + 50k, gift is 100% discounted
  });
});
