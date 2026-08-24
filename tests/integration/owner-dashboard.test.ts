import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { OwnerDashboardService } from '@server/services/owner-dashboard-service';
import { OwnerInvoiceService } from '@server/services/owner-invoice-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';

describe('Owner Dashboard Real Analytics (Acceptance Test)', () => {
  let storeId: string;
  let ownerUserId: string;
  let table1Id: string;
  let table2Id: string;
  let productBiaId: string;
  let productNuocSuoiId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.dashboard-test@example.com',
      displayName: 'System Admin',
    });

    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'Billiards Club Dashboard Test',
      ownerDisplayName: 'Store Owner',
      ownerEmail: 'owner.dashboard@example.com',
    }));

    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(storeId, 'areas', 'Khu Bida Lỗ');
    const existingUnits = (await catalog.listNamed(storeId, 'units')).results;
    const unitLon = existingUnits.find((u) => u.name === 'Lon')!;
    const unitChai = existingUnits.find((u) => u.name === 'Chai')!;
    const catDoUong = await catalog.createNamed(storeId, 'categories', 'Đồ uống');

    // Time product (60k/h)
    const timeProd = await catalog.createProduct(storeId, {
      name: 'Giờ Bida Lỗ',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProd.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });

    // Tables
    const t1 = await catalog.createTable({
      storeId,
      areaId: area.id,
      timeProductId: timeProd.id,
      name: 'Bàn 01',
      sortOrder: 1,
    });
    table1Id = t1.id;

    const t2 = await catalog.createTable({
      storeId,
      areaId: area.id,
      timeProductId: timeProd.id,
      name: 'Bàn 02',
      sortOrder: 2,
    });
    table2Id = t2.id;

    // Products
    const bia = await catalog.createProduct(storeId, {
      name: 'Bia Heineken',
      productType: 'QUANTITY',
      categoryId: catDoUong.id,
      unitId: unitLon.id,
      variants: [
        {
          name: 'Lon 330ml',
          salePriceVnd: 25_000,
          costPriceVnd: 15_000,
          promptPrice: false,
        },
      ],
    });
    productBiaId = bia.id;

    const nuocSuoi = await catalog.createProduct(storeId, {
      name: 'Nước suối Aquafina',
      productType: 'QUANTITY',
      categoryId: catDoUong.id,
      unitId: unitChai.id,
      variants: [
        {
          name: 'Chai 500ml',
          salePriceVnd: 10_000,
          costPriceVnd: 5_000,
          promptPrice: false,
        },
      ],
    });
    productNuocSuoiId = nuocSuoi.id;
  });

  it('aggregates real data for today across invoices, uncompleted orders, categories, top items and payment methods', async () => {
    const pos = new PosService(env);

    // 1. Open Table 1, Add items, and Checkout with CASH
    const tables = await pos.listTables(storeId);
    const t1 = tables.find((t) => t.id === table1Id)!;

    const open1 = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-open-1',
      idempotencyKey: 'cmd-d-open-1',
      tableId: table1Id,
      expectedTableVersion: t1.version,
    });

    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-add-1',
      idempotencyKey: 'cmd-d-add-1',
      orderId: open1.orderId,
      productId: productBiaId,
      quantityMilli: 2000, // 2 lon = 50,000 VND
      expectedOrderVersion: 1,
    });

    const checkout1 = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-checkout-1',
      idempotencyKey: 'cmd-d-checkout-1',
      orderId: open1.orderId,
      expectedOrderVersion: 2,
      method: 'CASH',
      cashReceivedVnd: 100_000,
    });
    expect(checkout1.invoiceId).toBeDefined();

    // 2. Create a Takeaway order, Add water, Checkout with BANK_TRANSFER
    const takeaway = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-takeaway-1',
      idempotencyKey: 'cmd-d-takeaway-1',
      note: 'Khách mua mang về',
    });

    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-add-takeaway',
      idempotencyKey: 'cmd-d-add-takeaway',
      orderId: takeaway.orderId,
      productId: productNuocSuoiId,
      quantityMilli: 3000, // 3 chai = 30,000 VND
      expectedOrderVersion: 1,
    });

    const checkoutTakeaway = await pos.checkout({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-checkout-takeaway',
      idempotencyKey: 'cmd-d-checkout-takeaway',
      orderId: takeaway.orderId,
      expectedOrderVersion: 2,
      method: 'BANK_TRANSFER',
      cashReceivedVnd: null,
    });
    expect(checkoutTakeaway.invoiceId).toBeDefined();

    // 3. Open Table 2 and leave it OPEN (Uncompleted order)
    const t2 = (await pos.listTables(storeId)).find((t) => t.id === table2Id)!;
    const open2 = await pos.openTable({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-open-2',
      idempotencyKey: 'cmd-d-open-2',
      tableId: table2Id,
      expectedTableVersion: t2.version,
    });

    await pos.addItem({
      storeId,
      actorId: ownerUserId,
      requestId: 'req-d-add-2',
      idempotencyKey: 'cmd-d-add-2',
      orderId: open2.orderId,
      productId: productBiaId,
      quantityMilli: 4000, // 4 lon = 100,000 VND
      expectedOrderVersion: 1,
    });

    // 4. Fetch Dashboard Data
    const dashboardService = new OwnerDashboardService(env);
    const data = await dashboardService.getDashboardData(storeId, { range: 'today' });

    // Assert Summary KPIs
    expect(data.summary.invoiceCount).toBe(2);
    expect(data.summary.customerCount).toBe(0);
    expect(data.summary.avgItemsPerInvoice).toBe(2.5); // 2 beers + 3 water = 5 items across 2 invoices
    expect(data.summary.revenue).toBeGreaterThanOrEqual(80_000); // 50k + 30k + time
    expect(data.summary.subtotal).toBeGreaterThanOrEqual(80_000);
    expect(data.summary.avgRevenuePerInvoice).toBeGreaterThanOrEqual(40_000);

    // Assert Uncompleted Orders
    expect(data.uncompletedOrders.dineIn.count).toBe(1);
    expect(data.uncompletedOrders.dineIn.amount).toBeGreaterThanOrEqual(100_000);
    expect(data.uncompletedOrders.total.count).toBe(1);

    // Assert Timeline & Payment Time charts
    expect(data.revenueTimelineChart).toHaveLength(24);
    expect(data.paymentTimeChart).toHaveLength(24);
    const sumTimelineRev = data.revenueTimelineChart.reduce((sum, p) => sum + p.revenue, 0);
    expect(sumTimelineRev).toBe(data.summary.revenue);

    // Assert Payment Methods (CASH & BANK_TRANSFER)
    expect(data.paymentMethods.byRevenue.some((p) => p.key === 'CASH' && p.value > 0)).toBe(true);
    expect(
      data.paymentMethods.byRevenue.some((p) => p.key === 'BANK_TRANSFER' && p.value > 0),
    ).toBe(true);
    expect(data.paymentMethods.byCount.find((p) => p.key === 'CASH')?.value).toBe(1);
    expect(data.paymentMethods.byCount.find((p) => p.key === 'BANK_TRANSFER')?.value).toBe(1);

    // Assert Order Types (DINE_IN & TAKEAWAY)
    expect(
      data.orderTypes.byRevenue.find((o) => o.key === 'DINE_IN')?.value,
    ).toBeGreaterThanOrEqual(50_000);
    expect(data.orderTypes.byRevenue.find((o) => o.key === 'TAKEAWAY')?.value).toBe(30_000);

    // Assert Categories & Top Products
    expect(data.categories.byAmount.some((c) => c.label === 'Đồ uống')).toBe(true);
    expect(data.topProducts.byAmount.some((p) => p.productName === 'Bia Heineken')).toBe(true);
    expect(data.topProducts.byAmount.some((p) => p.productName === 'Nước suối Aquafina')).toBe(
      true,
    );

    // Assert Staff Revenue
    expect(data.staffRevenue.length).toBeGreaterThanOrEqual(1);
    expect(data.staffRevenue.some((s) => s.userId === ownerUserId && s.amount > 0)).toBe(true);
  });

  it('uses the exact POS quote for unfinished TIME_BLOCK orders', async () => {
    const platform = new PlatformService(env);
    const blockStore = await platform.createStore({
      name: 'Dashboard Time Block Accuracy Test',
      ownerDisplayName: 'Block Store Owner',
      ownerEmail: 'owner.dashboard-block@example.com',
    });
    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(blockStore.storeId, 'areas', 'Khu Block');
    const timeProduct = await catalog.createProduct(blockStore.storeId, {
      name: 'Giờ chơi theo block',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(blockStore.storeId, {
      productId: timeProduct.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'TIME_BLOCK',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: true, durationSeconds: 120, priceVnd: 40_000 },
      specialWindows: [],
    });
    const table = await catalog.createTable({
      storeId: blockStore.storeId,
      areaId: area.id,
      timeProductId: timeProduct.id,
      name: 'Bàn Block A',
    });

    const pos = new PosService(env);
    const openedAt = Date.now() - 30_000;
    const opened = await pos.openTable({
      storeId: blockStore.storeId,
      actorId: blockStore.ownerUserId,
      requestId: 'req-dashboard-block-open',
      idempotencyKey: 'cmd-dashboard-block-open',
      tableId: table.id,
      expectedTableVersion: 1,
      now: openedAt,
    });

    const dashboardService = new OwnerDashboardService(env);
    const runningQuote = await pos.quote(blockStore.storeId, opened.orderId);
    const runningDashboard = await dashboardService.getDashboardData(blockStore.storeId, {
      range: 'today',
    });

    expect(runningQuote.totalVnd).toBe(40_000);
    expect(runningDashboard.uncompletedOrders.dineIn).toEqual({ count: 1, amount: 40_000 });
    expect(runningDashboard.uncompletedOrders.total).toEqual({ count: 1, amount: 40_000 });

    const stopped = await pos.stopTimeForCheckout({
      storeId: blockStore.storeId,
      actorId: blockStore.ownerUserId,
      requestId: 'req-dashboard-block-stop',
      idempotencyKey: 'cmd-dashboard-block-stop',
      orderId: opened.orderId,
      expectedOrderVersion: 1,
      now: openedAt + 30_000,
    });
    const pendingDashboard = await dashboardService.getDashboardData(blockStore.storeId, {
      range: 'today',
    });

    expect(stopped.quote.totalVnd).toBe(40_000);
    expect(pendingDashboard.uncompletedOrders.dineIn).toEqual({ count: 1, amount: 40_000 });
  });

  it('allows owner to permanently delete an invoice and updates reports accordingly', async () => {
    const invoiceService = new OwnerInvoiceService(env);
    const dashboardService = new OwnerDashboardService(env);

    // List invoices before deletion
    const listBefore = await invoiceService.listInvoices({
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
    expect(listBefore.total).toBe(2);
    const invoiceToDelete = listBefore.results[0]!;
    expect(invoiceToDelete).toBeDefined();

    // Delete invoice
    const deleteResult = await invoiceService.deleteInvoice({
      storeId,
      targetId: invoiceToDelete.orderId,
      actorUserId: ownerUserId,
      requestId: 'req-test-delete-inv',
    });
    expect(deleteResult.deleted).toBe(true);
    expect(deleteResult.orderId).toBe(invoiceToDelete.orderId);

    // Verify invoice list after deletion
    const listAfter = await invoiceService.listInvoices({
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
    expect(listAfter.total).toBe(1);

    // Verify dashboard report reflects the deletion
    const dataAfter = await dashboardService.getDashboardData(storeId, { range: 'today' });
    expect(dataAfter.summary.invoiceCount).toBe(1);
  });
});
