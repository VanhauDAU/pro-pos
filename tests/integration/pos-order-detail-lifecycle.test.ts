import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { OwnerInvoiceService } from '@server/services/owner-invoice-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';

describe('POS Order Detail & Lifecycle Audit (Acceptance Test)', () => {
  let storeId: string;
  let ownerUserId: string;
  let tableAId: string;
  let tableBId: string;
  let cocaId: string;
  let stingId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.order-detail@example.com',
      displayName: 'System POS',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'Billiards Club Detail Test',
      ownerDisplayName: 'Store Owner',
      ownerEmail: 'owner.detail@example.com',
    }));

    const catalog = new CatalogService(env);
    const areaA = await catalog.createNamed(storeId, 'areas', 'Khu Líp');
    const areaB = await catalog.createNamed(storeId, 'areas', 'Khu Lỗ');
    const unitLon = await catalog.createNamed(storeId, 'units', 'Lon');

    // Time Product A (30,000 VND / hour)
    const timeProductA = await catalog.createProduct(storeId, {
      name: 'Giờ Líp Thường',
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

    // Time Product B (60,000 VND / hour)
    const timeProductB = await catalog.createProduct(storeId, {
      name: 'Giờ Lỗ VIP',
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

    const tableA = await catalog.createTable({
      storeId,
      areaId: areaA.id,
      timeProductId: timeProductA.id,
      name: 'Bàn Líp-01',
      sortOrder: 1,
    });
    tableAId = tableA.id;

    const tableB = await catalog.createTable({
      storeId,
      areaId: areaB.id,
      timeProductId: timeProductB.id,
      name: 'Bàn Lỗ-02',
      sortOrder: 2,
    });
    tableBId = tableB.id;

    // Items
    const coca = await catalog.createProduct(storeId, {
      name: 'Coca Cola',
      productType: 'QUANTITY',
      unitId: unitLon.id,
      variants: [
        {
          name: 'Lon 330ml',
          salePriceVnd: 15_000,
          costPriceVnd: 8_000,
          promptPrice: false,
        },
      ],
    });
    cocaId = coca.id;

    const sting = await catalog.createProduct(storeId, {
      name: 'Sting Dâu',
      productType: 'QUANTITY',
      unitId: unitLon.id,
      variants: [
        {
          name: 'Chai 330ml',
          salePriceVnd: 15_000,
          costPriceVnd: 8_000,
          promptPrice: false,
        },
      ],
    });
    stingId = sting.id;
  });

  it('runs complete 8-step lifecycle and produces full authoritative order detail DTO', async () => {
    const pos = new PosService(env);
    const t0 = new Date('2026-08-20T19:00:00+07:00').getTime();

    // 1. Mở Bàn A giá 30k lúc 19:00
    const openRes = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-open-table',
      idempotencyKey: 'cmd-open-table-a',
      tableId: tableAId,
      expectedTableVersion: 1,
      now: t0,
    });
    const orderId = openRes.orderId;
    expect(orderId).toBeDefined();

    // Verify detail immediately after open
    let detail = await pos.getOrderDetail(storeId, orderId, t0 + 60_000);
    expect(detail.order.status).toBe('OPEN');
    expect(detail.order.tableName).toBe('Bàn Líp-01');
    expect(detail.timeSegments).toHaveLength(1);
    expect(detail.timeSegments[0]!.unitPriceSnapshot).toBe(30_000);
    expect(detail.timeSegments[0]!.isCurrentActive).toBe(true);

    // 2. Gọi 2 Coca lúc 19:10
    const tItem1 = t0 + 10 * 60_000;
    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-add-coca',
      idempotencyKey: 'cmd-add-coca',
      orderId,
      productId: cocaId,
      quantityMilli: 2000, // 2 lon
      expectedOrderVersion: 1,
      note: 'Ướp lạnh',
      now: tItem1,
    });

    // 3. Lúc 20:00 chuyển A -> B giá 60k
    const t1 = t0 + 3600_000; // 20:00
    await pos.transfer({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-transfer-table',
      idempotencyKey: 'cmd-transfer-a-to-b',
      orderId,
      targetTableId: tableBId,
      expectedOrderVersion: 2,
      expectedSourceTableVersion: 2,
      expectedTargetTableVersion: 1,
      now: t1,
    });

    // 4. Lúc 20:30 thêm Sting giảm 5.000đ
    const tItem2 = t0 + 90 * 60_000;
    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-add-sting',
      idempotencyKey: 'cmd-add-sting',
      orderId,
      productId: stingId,
      quantityMilli: 1000, // 1 chai
      expectedOrderVersion: 3,
      discount: {
        type: 'FIXED',
        value: 5000,
      },
      now: tItem2,
    });

    // 5. Lúc 21:00 bấm Thanh toán (Dừng tính giờ / PAYMENT_PENDING)
    const t2 = t0 + 7200_000; // 21:00
    const stopRes1 = await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-time-1',
      idempotencyKey: 'cmd-stop-time-1',
      orderId,
      expectedOrderVersion: 4,
      now: t2,
    });
    expect(stopRes1.status).toBe('PAYMENT_PENDING');

    detail = await pos.getOrderDetail(storeId, orderId, t2 + 60_000);
    expect(detail.order.status).toBe('PAYMENT_PENDING');
    expect(detail.timeSegments).toHaveLength(2);
    expect(detail.timeSegments[0]!.tableName).toBe('Bàn Líp-01');
    expect(detail.timeSegments[0]!.elapsedSeconds).toBe(3600);
    expect(detail.timeSegments[0]!.amountAfterRoundingVnd).toBe(30_000);
    expect(detail.timeSegments[1]!.tableName).toBe('Bàn Lỗ-02');
    expect(detail.timeSegments[1]!.elapsedSeconds).toBe(3600);
    expect(detail.timeSegments[1]!.amountAfterRoundingVnd).toBe(60_000);
    expect(detail.checkout?.status).toBe('CHECKOUT_PENDING');

    // 6. Lúc 21:05 Tiếp tục chơi
    const t3 = t2 + 5 * 60_000; // 21:05
    const resumeRes = await pos.resumeCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-resume-1',
      idempotencyKey: 'cmd-resume-1',
      orderId,
      expectedOrderVersion: 5,
      now: t3,
    });
    expect(resumeRes).toBeDefined();

    // 7. Lúc 21:30 bấm Thanh toán lần nữa (Dừng tính giờ)
    const t4 = t3 + 25 * 60_000; // 21:30
    await pos.stopTimeForCheckout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-stop-time-2',
      idempotencyKey: 'cmd-stop-time-2',
      orderId,
      expectedOrderVersion: 6,
      now: t4,
    });

    // 8. Thanh toán tiền mặt thành công lúc 21:31
    const t5 = t4 + 60_000; // 21:31
    const checkoutRes = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-checkout-final',
      idempotencyKey: 'cmd-checkout-final',
      orderId,
      expectedOrderVersion: 7,
      method: 'CASH',
      cashReceivedVnd: 200_000,
      now: t5,
    });
    expect(checkoutRes.invoiceId).toBeDefined();

    // Final Detail Verification
    detail = await pos.getOrderDetail(storeId, orderId, t5);

    // 1. General Order Info
    expect(detail.order.status).toBe('PAID');
    expect(detail.order.orderType).toBe('DINE_IN');
    expect(detail.order.tableName).toBe('Bàn Lỗ-02');
    expect(detail.order.tableUsageChain).toEqual(['Bàn Líp-01', 'Bàn Lỗ-02']);

    // 2. Multi-Segment Time Breakdown
    expect(detail.timeSegments).toHaveLength(3);

    // Segment 1: Bàn Líp-01 (19:00 -> 20:00 @ 30k)
    expect(detail.timeSegments[0]!.tableName).toBe('Bàn Líp-01');
    expect(detail.timeSegments[0]!.startedAt).toBe(t0);
    expect(detail.timeSegments[0]!.endedAt).toBe(t1);
    expect(detail.timeSegments[0]!.elapsedSeconds).toBe(3600);
    expect(detail.timeSegments[0]!.unitPriceSnapshot).toBe(30_000);
    expect(detail.timeSegments[0]!.amountAfterRoundingVnd).toBe(30_000);

    // Segment 2: Bàn Lỗ-02 (20:00 -> 21:00 @ 60k)
    expect(detail.timeSegments[1]!.tableName).toBe('Bàn Lỗ-02');
    expect(detail.timeSegments[1]!.startedAt).toBe(t1);
    expect(detail.timeSegments[1]!.endedAt).toBe(t2);
    expect(detail.timeSegments[1]!.elapsedSeconds).toBe(3600);
    expect(detail.timeSegments[1]!.unitPriceSnapshot).toBe(60_000);
    expect(detail.timeSegments[1]!.amountAfterRoundingVnd).toBe(60_000);

    // Segment 3: Bàn Lỗ-02 (21:05 -> 21:30 @ 60k)
    expect(detail.timeSegments[2]!.tableName).toBe('Bàn Lỗ-02');
    expect(detail.timeSegments[2]!.startedAt).toBe(t3);
    expect(detail.timeSegments[2]!.endedAt).toBe(t4);
    expect(detail.timeSegments[2]!.elapsedSeconds).toBe(1500); // 25 minutes = 1500s
    expect(detail.timeSegments[2]!.unitPriceSnapshot).toBe(60_000);
    // 25 mins @ 60k/h = 25,000 VND -> rounded to nearest 1000 = 25,000 VND
    expect(detail.timeSegments[2]!.amountAfterRoundingVnd).toBe(25_000);

    // Total Time: 3600 + 3600 + 1500 = 8700s (2h 25m). Total Amount = 30k + 60k + 25k = 115k
    expect(detail.timeSummary?.totalElapsedSeconds).toBe(8700);
    expect(detail.timeSummary?.totalAmountAfterRoundingVnd).toBe(115_000);

    // 3. Table Transfer History
    expect(detail.tableTransfers).toHaveLength(1);
    expect(detail.tableTransfers[0]!.fromTableName).toBe('Bàn Líp-01');
    expect(detail.tableTransfers[0]!.toTableName).toBe('Bàn Lỗ-02');
    expect(detail.tableTransfers[0]!.oldRateVnd).toBe(30_000);
    expect(detail.tableTransfers[0]!.newRateVnd).toBe(60_000);

    // 4. Items Breakdown
    expect(detail.items).toHaveLength(2);
    const cocaItem = detail.items.find((i) => i.productNameSnapshot === 'Coca Cola');
    const stingItem = detail.items.find((i) => i.productNameSnapshot === 'Sting Dâu');
    expect(cocaItem).toBeDefined();
    expect(cocaItem!.quantityMilli).toBe(2000);
    expect(cocaItem!.unitPriceSnapshot).toBe(15_000);
    expect(cocaItem!.grossLineTotalVnd).toBe(30_000);
    expect(cocaItem!.discountAmountVnd).toBe(0);
    expect(cocaItem!.netLineTotalVnd).toBe(30_000);
    expect(cocaItem!.note).toBe('Ướp lạnh');

    expect(stingItem).toBeDefined();
    expect(stingItem!.quantityMilli).toBe(1000);
    expect(stingItem!.unitPriceSnapshot).toBe(15_000);
    expect(stingItem!.grossLineTotalVnd).toBe(15_000);
    expect(stingItem!.discountAmountVnd).toBe(5000);
    expect(stingItem!.netLineTotalVnd).toBe(10_000);

    // 5. Financial Totals
    // Time: 115,000 VND
    // Items Gross: 45,000 VND
    // Discount: 5,000 VND
    // Subtotal: 160,000 VND
    // Total: 155,000 VND
    // Cash Received: 200,000 VND -> Change: 45,000 VND
    expect(detail.totals.timeAmountVnd).toBe(115_000);
    expect(detail.totals.itemGrossAmountVnd).toBe(45_000);
    expect(detail.totals.totalDiscountVnd).toBe(5000);
    expect(detail.totals.totalVnd).toBe(155_000);
    expect(detail.totals.paidAmountVnd).toBe(155_000);
    expect(detail.totals.changeAmountVnd).toBe(45_000);

    // 6. Payments
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]!.method).toBe('CASH');
    expect(detail.payments[0]!.amount).toBe(155_000);
    expect(detail.payments[0]!.cashReceived).toBe(200_000);
    expect(detail.payments[0]!.cashChange).toBe(45_000);
    expect(detail.payments[0]!.status).toBe('SUCCEEDED');

    // 7. Invoice Snapshot
    expect(detail.invoice).toBeDefined();
    expect(detail.invoice!.status).toBe('COMPLETED');
    expect(detail.invoice!.totalVnd).toBe(155_000);

    // 8. Audit Timeline
    expect(detail.auditEvents.length).toBeGreaterThanOrEqual(6);
    const actions = detail.auditEvents.map((e) => e.action);
    expect(actions).toContain('TABLE_OPENED');
    expect(actions).toContain('ORDER_ITEM_ADDED');
    expect(actions).toContain('TABLE_TRANSFERRED');
    expect(actions).toContain('ORDER_CHECKOUT_PENDING');
    expect(actions).toContain('ORDER_RESUMED_FROM_CHECKOUT');
    expect(actions).toContain('CHECKOUT_COMPLETED');
  });

  it('correctly handles takeaway order detail', async () => {
    const pos = new PosService(env);
    const takeaway = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-takeaway-1',
      idempotencyKey: 'cmd-takeaway-1',
      note: 'Khách VIP mang đi',
    });

    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-takeaway-add',
      idempotencyKey: 'cmd-takeaway-add',
      orderId: takeaway.orderId,
      productId: cocaId,
      quantityMilli: 3000, // 3 lon
      expectedOrderVersion: 1,
    });

    const detail = await pos.getOrderDetail(storeId, takeaway.orderId);
    expect(detail.order.orderType).toBe('TAKEAWAY');
    expect(detail.order.note).toBe('Khách VIP mang đi');
    expect(detail.timeSummary).toBeNull();
    expect(detail.timeSegments).toHaveLength(0);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.productNameSnapshot).toBe('Coca Cola');
    expect(detail.items[0]!.quantityMilli).toBe(3000);
    expect(detail.totals.totalVnd).toBe(45_000);
  });

  it('correctly handles cancelled order detail with reason and audit trail', async () => {
    const pos = new PosService(env);
    const tables = await pos.listTables(storeId);
    const tableA = tables.find((t) => t.id === tableAId)!;
    const openRes = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-open-cancel',
      idempotencyKey: 'cmd-open-cancel',
      tableId: tableAId,
      expectedTableVersion: tableA.version,
    });

    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-add-cancel',
      idempotencyKey: 'cmd-add-cancel',
      orderId: openRes.orderId,
      productId: cocaId,
      quantityMilli: 1000,
      expectedOrderVersion: 1,
    });

    await pos.cancel({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-cancel-order',
      idempotencyKey: 'cmd-cancel-order',
      orderId: openRes.orderId,
      expectedOrderVersion: 2,
      reason: 'Khách có việc đột xuất phải về',
    });

    const detail = await pos.getOrderDetail(storeId, openRes.orderId);
    expect(detail.order.status).toBe('CANCELLED');
    expect(detail.order.cancelReason).toBe('Khách có việc đột xuất phải về');
    expect(detail.timeSegments.length).toBeGreaterThanOrEqual(1);
    expect(detail.items).toHaveLength(1);
    const cancelAudit = detail.auditEvents.find((e) => e.action === 'ORDER_CANCELLED');
    expect(cancelAudit).toBeDefined();
    expect(cancelAudit!.description).toContain('Khách có việc đột xuất phải về');

    // Verify Owner Invoices & Orders list
    const ownerInvoiceService = new OwnerInvoiceService(env);
    const allList = await ownerInvoiceService.listInvoices({
      storeId,
      status: undefined,
      search: '',
      orderType: undefined,
      method: undefined,
      dateFrom: null,
      dateTo: null,
      page: 1,
      limit: 20,
    });
    expect(
      allList.results.some((r) => r.orderId === openRes.orderId && r.status === 'CANCELLED'),
    ).toBe(true);

    const cancelledList = await ownerInvoiceService.listInvoices({
      storeId,
      status: 'CANCELLED',
      search: '',
      orderType: undefined,
      method: undefined,
      dateFrom: null,
      dateTo: null,
      page: 1,
      limit: 20,
    });
    expect(
      cancelledList.results.some((r) => r.orderId === openRes.orderId && r.status === 'CANCELLED'),
    ).toBe(true);

    const paidList = await ownerInvoiceService.listInvoices({
      storeId,
      status: 'PAID',
      search: '',
      orderType: undefined,
      method: undefined,
      dateFrom: null,
      dateTo: null,
      page: 1,
      limit: 20,
    });
    expect(paidList.results.some((r) => r.orderId === openRes.orderId)).toBe(false);
  });
});
