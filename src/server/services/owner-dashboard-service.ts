import type {
  DashboardDataDto,
  DashboardPaymentTimePoint,
  DashboardPieSlice,
  DashboardQueryInput,
  DashboardStaffRevenueRow,
  DashboardTimelinePoint,
  DashboardTopProductSlice,
} from '@contracts/dashboard';
import {
  OwnerDashboardRepository,
  type RawInvoiceRow,
  type RawLineItemRow,
} from '@server/repositories/owner-dashboard-repository';
import { PosService } from '@server/services/pos-service';
import type { AppEnv } from '@server/types';

import {
  addDateOnlyDays,
  getZonedParts,
  zonedDateTimeToTimestamp,
} from '@server/services/owner-revenue-report-service';

const PALETTE = [
  '#0975F7',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#F97316',
  '#6366F1',
  '#14B8A6',
  '#64748B',
];

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function dateParts(dateOnly: string) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function dateOnlyFromParts(parts: Pick<LocalParts, 'year' | 'month' | 'day'>) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function dateOnlyDayOfWeek(dateOnly: string) {
  const parts = dateParts(dateOnly);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function businessDateForTimestamp(timestamp: number, timezone: string, cutoffMinutes: number) {
  const parts = getZonedParts(timestamp, timezone);
  const localDate = dateOnlyFromParts(parts);
  return parts.hour * 60 + parts.minute < cutoffMinutes
    ? addDateOnlyDays(localDate, -1)
    : localDate;
}

export class OwnerDashboardService {
  private repository: OwnerDashboardRepository;
  private posService: PosService;

  constructor(env: AppEnv['Bindings']) {
    this.repository = new OwnerDashboardRepository(env.DB);
    this.posService = new PosService(env);
  }

  async getDashboardData(storeId: string, query: DashboardQueryInput): Promise<DashboardDataDto> {
    const now = Date.now();
    const settings = await this.repository.getStoreSettings(storeId);
    const timezone = settings?.timezone || 'Asia/Ho_Chi_Minh';
    const cutoffMinutes = Math.max(0, Math.min(1_439, settings?.businessDayCutoffMinutes ?? 0));

    const { fromMs, toMs, range, dateFrom, dateTo } = this.calculateDateRange(
      query,
      timezone,
      cutoffMinutes,
      now,
    );

    const [invoices, lines, activeOrders, staffList, customerCount] = await Promise.all([
      this.repository.getCompletedInvoices(storeId, fromMs, toMs),
      this.repository.getInvoiceLines(storeId, fromMs, toMs),
      this.posService.listOrders(storeId, now),
      this.repository.getStaffUsers(storeId),
      this.repository.countActiveCustomers(storeId),
    ]);

    // 1. Summary KPIs
    const subtotal = invoices.reduce((sum, i) => sum + i.subtotal, 0);
    const timeRevenue = Math.min(
      subtotal,
      lines
        .filter((line) => line.lineType === 'TIME')
        .reduce((sum, line) => sum + line.grossLineTotal, 0),
    );
    const goodsRevenue = Math.max(0, subtotal - timeRevenue);
    const discountTotal = invoices.reduce((sum, i) => sum + i.discountTotal, 0);
    const revenue = invoices.reduce((sum, i) => sum + i.total, 0);
    const invoiceCount = invoices.length;

    // Only count physical / retail products, excluding time duration service lines
    const productLines = lines.filter((l) => l.lineType === 'PRODUCT');
    const totalProductQuantity = productLines.reduce(
      (sum, l) => sum + (l.quantityMilli ? l.quantityMilli / 1000 : 1),
      0,
    );
    const avgItemsPerInvoice =
      invoiceCount > 0 ? Number((totalProductQuantity / invoiceCount).toFixed(1)) : 0;
    const avgRevenuePerInvoice = invoiceCount > 0 ? Math.round(revenue / invoiceCount) : 0;

    // 2. Uncompleted Orders Calculation
    // Use the exact POS quote for every active order. This keeps dashboard money
    // identical to checkout for time blocks, first periods, special windows,
    // rounding, pauses, transfers, discounts and PAYMENT_PENDING snapshots.
    const dineInOrders = activeOrders.filter((order) => order.orderType === 'DINE_IN');
    const takeawayOrders = activeOrders.filter((order) => order.orderType === 'TAKEAWAY');
    const dineInTotalAmount = dineInOrders.reduce((sum, order) => sum + order.totalVnd, 0);
    const dineInCount = dineInOrders.length;

    const takeawayAmount = takeawayOrders.reduce((sum, order) => sum + order.totalVnd, 0);
    const takeawayCount = takeawayOrders.length;

    const uncompletedSummary = {
      dineIn: { count: dineInCount, amount: dineInTotalAmount },
      takeaway: { count: takeawayCount, amount: takeawayAmount },
      total: {
        count: dineInCount + takeawayCount,
        amount: dineInTotalAmount + takeawayAmount,
      },
    };

    // 3. Revenue Timeline Chart
    const revenueTimelineChart = this.buildTimelineChart(
      invoices,
      lines,
      range,
      dateFrom,
      dateTo,
      timezone,
      cutoffMinutes,
    );

    // 4. Payment Time Chart (Hourly distribution 0..23 in store timezone)
    const paymentTimeChart = this.buildPaymentTimeChart(invoices, timezone);

    // 5. Staff Revenue
    const staffRevenue = this.buildStaffRevenue(invoices, staffList);

    // 6. Payment Methods (byRevenue & byCount)
    const paymentMethods = this.buildPaymentMethods(invoices);

    // 7. Order Types (byRevenue & byCount)
    const orderTypes = this.buildOrderTypes(invoices);

    // 8. Categories (byAmount & byQuantity)
    const categories = this.buildCategories(lines);

    // 9. Top Products (byAmount & byQuantity)
    const topProducts = this.buildTopProducts(lines);

    return {
      range,
      fromMs,
      toMs,
      summary: {
        subtotal,
        goodsRevenue,
        timeRevenue,
        discountTotal,
        revenue,
        customerCount,
        invoiceCount,
        avgItemsPerInvoice,
        avgRevenuePerInvoice,
      },
      uncompletedOrders: uncompletedSummary,
      revenueTimelineChart,
      paymentTimeChart,
      staffRevenue,
      paymentMethods,
      orderTypes,
      categories,
      topProducts,
    };
  }

  private calculateDateRange(
    query: DashboardQueryInput,
    timezone: string,
    cutoffMinutes: number,
    nowMs: number,
  ): {
    fromMs: number;
    toMs: number;
    range: 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';
    dateFrom: string;
    dateTo: string;
  } {
    const range = query.range;
    const businessToday = businessDateForTimestamp(nowMs, timezone, cutoffMinutes);
    let dateFrom = businessToday;
    let dateTo = businessToday;

    if (range === 'custom' && query.dateFrom && query.dateTo) {
      dateFrom = query.dateFrom;
      dateTo = query.dateTo;
    } else if (range === 'yesterday') {
      dateFrom = addDateOnlyDays(businessToday, -1);
      dateTo = dateFrom;
    } else if (range === 'week') {
      // Monday of current business week
      const daysFromMonday = (dateOnlyDayOfWeek(businessToday) + 6) % 7;
      dateFrom = addDateOnlyDays(businessToday, -daysFromMonday);
      dateTo = addDateOnlyDays(dateFrom, 6);
    } else if (range === 'month') {
      const parts = dateParts(businessToday);
      const lastDayOfMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
      dateFrom = `${businessToday.slice(0, 7)}-01`;
      dateTo = `${businessToday.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, '0')}`;
    } else if (range === 'year') {
      dateFrom = `${businessToday.slice(0, 4)}-01-01`;
      dateTo = `${businessToday.slice(0, 4)}-12-31`;
    }

    const fromMs = zonedDateTimeToTimestamp(dateFrom, cutoffMinutes, timezone);
    const toMs = zonedDateTimeToTimestamp(addDateOnlyDays(dateTo, 1), cutoffMinutes, timezone) - 1;

    return { fromMs, toMs, range, dateFrom, dateTo };
  }

  private buildTimelineChart(
    invoices: RawInvoiceRow[],
    lines: RawLineItemRow[],
    range: string,
    dateFrom: string,
    dateTo: string,
    timezone: string,
    cutoffMinutes: number,
  ): DashboardTimelinePoint[] {
    if (range === 'today' || range === 'yesterday') {
      // 24-hour buckets
      const points: DashboardTimelinePoint[] = Array.from({ length: 24 }, (_, h) => ({
        label: `${String(h).padStart(2, '0')}:00`,
        revenue: 0,
        goodsRevenue: 0,
        timeRevenue: 0,
        invoiceCount: 0,
      }));

      const timeByInvoice = this.timeRevenueByInvoice(lines);

      for (const inv of invoices) {
        const hour = getZonedParts(inv.issuedAt, timezone).hour;
        if (points[hour]) {
          const invoiceTimeRevenue = Math.min(inv.subtotal, timeByInvoice.get(inv.id) ?? 0);
          points[hour]!.revenue += inv.total;
          points[hour]!.timeRevenue += invoiceTimeRevenue;
          points[hour]!.goodsRevenue += Math.max(0, inv.subtotal - invoiceTimeRevenue);
          points[hour]!.invoiceCount += 1;
        }
      }
      return points;
    }

    // Multi-day buckets from dateFrom to dateTo
    const bucketMap = new Map<string, DashboardTimelinePoint>();
    let curr = dateFrom;
    while (curr <= dateTo) {
      const parts = dateParts(curr);
      const label = `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}`;
      bucketMap.set(curr, {
        label,
        revenue: 0,
        goodsRevenue: 0,
        timeRevenue: 0,
        invoiceCount: 0,
      });
      curr = addDateOnlyDays(curr, 1);
    }

    const timeByInvoice = this.timeRevenueByInvoice(lines);
    for (const inv of invoices) {
      const key = businessDateForTimestamp(inv.issuedAt, timezone, cutoffMinutes);
      const bucket = bucketMap.get(key);
      if (bucket) {
        const invoiceTimeRevenue = Math.min(inv.subtotal, timeByInvoice.get(inv.id) ?? 0);
        bucket.revenue += inv.total;
        bucket.timeRevenue += invoiceTimeRevenue;
        bucket.goodsRevenue += Math.max(0, inv.subtotal - invoiceTimeRevenue);
        bucket.invoiceCount += 1;
      }
    }

    return Array.from(bucketMap.values());
  }

  private timeRevenueByInvoice(lines: RawLineItemRow[]) {
    const totals = new Map<string, number>();
    for (const line of lines) {
      if (line.lineType !== 'TIME') continue;
      totals.set(line.invoiceId, (totals.get(line.invoiceId) ?? 0) + line.grossLineTotal);
    }
    return totals;
  }

  private buildPaymentTimeChart(
    invoices: RawInvoiceRow[],
    timezone: string,
  ): DashboardPaymentTimePoint[] {
    const points: DashboardPaymentTimePoint[] = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      hourLabel: `${String(h).padStart(2, '0')}:00 - ${String(h).padStart(2, '0')}:59`,
      revenue: 0,
      invoiceCount: 0,
    }));

    for (const inv of invoices) {
      const hour = getZonedParts(inv.issuedAt, timezone).hour;
      if (points[hour]) {
        points[hour]!.revenue += inv.total;
        points[hour]!.invoiceCount += 1;
      }
    }

    return points;
  }

  private buildStaffRevenue(
    invoices: RawInvoiceRow[],
    staffList: { userId: string; displayName: string; roleName: string | null }[],
  ): DashboardStaffRevenueRow[] {
    const map = new Map<
      string,
      {
        userId: string;
        displayName: string;
        roleName: string | null;
        amount: number;
        invoiceCount: number;
      }
    >();

    // Initialize with staff list
    for (const s of staffList) {
      map.set(s.userId, {
        userId: s.userId,
        displayName: s.displayName,
        roleName: s.roleName,
        amount: 0,
        invoiceCount: 0,
      });
    }

    for (const inv of invoices) {
      const actorId = inv.issuedBy || 'unknown';
      const actorName = inv.actorName || 'Nhân viên';
      const existing = map.get(actorId);
      if (existing) {
        existing.amount += inv.total;
        existing.invoiceCount += 1;
      } else {
        map.set(actorId, {
          userId: actorId,
          displayName: actorName,
          roleName: null,
          amount: inv.total,
          invoiceCount: 1,
        });
      }
    }

    return Array.from(map.values())
      .filter((s) => s.amount > 0 || s.invoiceCount > 0)
      .toSorted((a, b) => b.amount - a.amount);
  }

  private buildPaymentMethods(invoices: RawInvoiceRow[]) {
    let cashRev = 0;
    let cashCount = 0;
    let transferRev = 0;
    let transferCount = 0;
    let otherRev = 0;
    let otherCount = 0;

    for (const inv of invoices) {
      if (inv.method === 'CASH') {
        cashRev += inv.total;
        cashCount += 1;
      } else if (inv.method === 'BANK_TRANSFER') {
        transferRev += inv.total;
        transferCount += 1;
      } else {
        otherRev += inv.total;
        otherCount += 1;
      }
    }

    const totalRev = cashRev + transferRev + otherRev || 1;
    const totalCount = cashCount + transferCount + otherCount || 1;

    const byRevenue: DashboardPieSlice[] = [
      {
        key: 'CASH',
        label: 'Tiền mặt',
        value: cashRev,
        percentage: Number(((cashRev / totalRev) * 100).toFixed(1)),
        color: '#10B981',
      },
      {
        key: 'BANK_TRANSFER',
        label: 'Chuyển khoản / QR',
        value: transferRev,
        percentage: Number(((transferRev / totalRev) * 100).toFixed(1)),
        color: '#0975F7',
      },
    ];
    if (otherRev > 0) {
      byRevenue.push({
        key: 'OTHER',
        label: 'Khác',
        value: otherRev,
        percentage: Number(((otherRev / totalRev) * 100).toFixed(1)),
        color: '#8B5CF6',
      });
    }

    const byCount: DashboardPieSlice[] = [
      {
        key: 'CASH',
        label: 'Tiền mặt',
        value: cashCount,
        percentage: Number(((cashCount / totalCount) * 100).toFixed(1)),
        color: '#10B981',
      },
      {
        key: 'BANK_TRANSFER',
        label: 'Chuyển khoản / QR',
        value: transferCount,
        percentage: Number(((transferCount / totalCount) * 100).toFixed(1)),
        color: '#0975F7',
      },
    ];
    if (otherCount > 0) {
      byCount.push({
        key: 'OTHER',
        label: 'Khác',
        value: otherCount,
        percentage: Number(((otherCount / totalCount) * 100).toFixed(1)),
        color: '#8B5CF6',
      });
    }

    return { byRevenue, byCount };
  }

  private buildOrderTypes(invoices: RawInvoiceRow[]) {
    let dineInRev = 0;
    let dineInCount = 0;
    let takeawayRev = 0;
    let takeawayCount = 0;

    for (const inv of invoices) {
      if (inv.orderType === 'DINE_IN') {
        dineInRev += inv.total;
        dineInCount += 1;
      } else {
        takeawayRev += inv.total;
        takeawayCount += 1;
      }
    }

    const totalRev = dineInRev + takeawayRev || 1;
    const totalCount = dineInCount + takeawayCount || 1;

    const byRevenue: DashboardPieSlice[] = [
      {
        key: 'DINE_IN',
        label: 'Tại bàn',
        value: dineInRev,
        percentage: Number(((dineInRev / totalRev) * 100).toFixed(1)),
        color: '#0975F7',
      },
      {
        key: 'TAKEAWAY',
        label: 'Mang về',
        value: takeawayRev,
        percentage: Number(((takeawayRev / totalRev) * 100).toFixed(1)),
        color: '#F59E0B',
      },
    ];

    const byCount: DashboardPieSlice[] = [
      {
        key: 'DINE_IN',
        label: 'Tại bàn',
        value: dineInCount,
        percentage: Number(((dineInCount / totalCount) * 100).toFixed(1)),
        color: '#0975F7',
      },
      {
        key: 'TAKEAWAY',
        label: 'Mang về',
        value: takeawayCount,
        percentage: Number(((takeawayCount / totalCount) * 100).toFixed(1)),
        color: '#F59E0B',
      },
    ];

    return { byRevenue, byCount };
  }

  private buildCategories(lines: RawLineItemRow[]) {
    const map = new Map<string, { categoryName: string; amount: number; quantity: number }>();

    for (const line of lines) {
      const catName =
        line.lineType === 'TIME' ? 'Dịch vụ Giờ chơi' : line.categoryName || 'Chưa phân loại';
      const qty = line.quantityMilli ? line.quantityMilli / 1000 : 1;
      const amt = line.lineTotal || 0;

      const existing = map.get(catName);
      if (existing) {
        existing.amount += amt;
        existing.quantity += qty;
      } else {
        map.set(catName, { categoryName: catName, amount: amt, quantity: qty });
      }
    }

    const totalAmt = Array.from(map.values()).reduce((sum, c) => sum + c.amount, 0) || 1;
    const totalQty = Array.from(map.values()).reduce((sum, c) => sum + c.quantity, 0) || 1;

    const byAmountList = Array.from(map.values())
      .toSorted((a, b) => b.amount - a.amount)
      .map((item, idx) => ({
        key: item.categoryName,
        label: item.categoryName,
        value: item.amount,
        percentage: Number(((item.amount / totalAmt) * 100).toFixed(1)),
        color: PALETTE[idx % PALETTE.length]!,
      }));

    const byQuantityList = Array.from(map.values())
      .toSorted((a, b) => b.quantity - a.quantity)
      .map((item, idx) => ({
        key: item.categoryName,
        label: item.categoryName,
        value: Math.round(item.quantity * 10) / 10,
        percentage: Number(((item.quantity / totalQty) * 100).toFixed(1)),
        color: PALETTE[idx % PALETTE.length]!,
      }));

    return {
      byAmount: byAmountList,
      byQuantity: byQuantityList,
    };
  }

  private buildTopProducts(lines: RawLineItemRow[]) {
    const map = new Map<
      string,
      {
        productId: string;
        productName: string;
        unitName: string | null;
        amount: number;
        quantity: number;
      }
    >();

    for (const line of lines) {
      if (line.lineType === 'TIME') {
        const key = 'TIME_SERVICE';
        const existing = map.get(key);
        if (existing) {
          existing.amount += line.lineTotal || 0;
          existing.quantity += 1;
        } else {
          map.set(key, {
            productId: 'time-billing',
            productName: 'Tiền giờ bida / dịch vụ',
            unitName: 'Giờ',
            amount: line.lineTotal || 0,
            quantity: 1,
          });
        }
        continue;
      }

      const pId = line.productId || line.description || 'other';
      const pName = line.productName || line.description || 'Mặt hàng';
      const qty = line.quantityMilli ? line.quantityMilli / 1000 : 1;
      const amt = line.lineTotal || 0;

      const existing = map.get(pId);
      if (existing) {
        existing.amount += amt;
        existing.quantity += qty;
      } else {
        map.set(pId, {
          productId: pId,
          productName: pName,
          unitName: line.unitName,
          amount: amt,
          quantity: qty,
        });
      }
    }

    const totalAmt = Array.from(map.values()).reduce((sum, p) => sum + p.amount, 0) || 1;
    const totalQty = Array.from(map.values()).reduce((sum, p) => sum + p.quantity, 0) || 1;

    const byAmount: DashboardTopProductSlice[] = Array.from(map.values())
      .toSorted((a, b) => b.amount - a.amount)
      .slice(0, 8)
      .map((item, idx) => ({
        productId: item.productId,
        productName: item.productName,
        unitName: item.unitName,
        value: item.amount,
        percentage: Number(((item.amount / totalAmt) * 100).toFixed(1)),
        color: PALETTE[idx % PALETTE.length]!,
      }));

    const byQuantity: DashboardTopProductSlice[] = Array.from(map.values())
      .toSorted((a, b) => b.quantity - a.quantity)
      .slice(0, 8)
      .map((item, idx) => ({
        productId: item.productId,
        productName: item.productName,
        unitName: item.unitName,
        value: Math.round(item.quantity * 10) / 10,
        percentage: Number(((item.quantity / totalQty) * 100).toFixed(1)),
        color: PALETTE[idx % PALETTE.length]!,
      }));

    return { byAmount, byQuantity };
  }
}
