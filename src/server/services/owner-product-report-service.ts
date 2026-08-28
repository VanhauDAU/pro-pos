import type {
  ProductReportCategoryProductItem,
  ProductReportCategoryRow,
  ProductReportChartSlice,
  ProductReportComparisonDto,
  ProductReportDetailResponseDto,
  ProductReportQueryInput,
  ProductReportResponseDto,
  ProductReportSummaryDto,
  ProductReportTopSellingRow,
} from '@contracts/reports';
import { AppError } from '@server/lib/app-error';
import {
  OwnerProductReportRepository,
  type RawCancelledItemRow,
  type RawReportLineRow,
} from '@server/repositories/owner-product-report-repository';
import type { AppEnv } from '@server/types';

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

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

function vnStartOfDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) - VN_OFFSET_MS;
}

function vnEndOfDay(value: Date) {
  return vnStartOfDay(value) + DAY_MS - 1;
}

function vnDateAtStart(dateOnly: string) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) - VN_OFFSET_MS;
}

function shiftVnTimestamp(timestamp: number, input: { months?: number; years?: number }) {
  const local = new Date(timestamp + VN_OFFSET_MS);
  const initialMonth = local.getUTCMonth() + (input.months ?? 0);
  const targetYear = local.getUTCFullYear() + (input.years ?? 0) + Math.floor(initialMonth / 12);
  const targetMonth = ((initialMonth % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(local.getUTCDate(), daysInTargetMonth);

  return (
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
      local.getUTCMilliseconds(),
    ) - VN_OFFSET_MS
  );
}

export function resolveProductReportDateRange(
  query: ProductReportQueryInput,
  nowMs = Date.now(),
): { fromMs: number; toMs: number } {
  const vnNow = new Date(nowMs + VN_OFFSET_MS);

  switch (query.timeRange) {
    case 'today':
      return { fromMs: vnStartOfDay(vnNow), toMs: nowMs };
    case 'yesterday': {
      const yesterday = new Date(vnNow.getTime() - DAY_MS);
      return { fromMs: vnStartOfDay(yesterday), toMs: vnEndOfDay(yesterday) };
    }
    case 'last_7_days': {
      const sixDaysAgo = new Date(vnNow.getTime() - 6 * DAY_MS);
      return { fromMs: vnStartOfDay(sixDaysAgo), toMs: nowMs };
    }
    case 'this_week': {
      const dayFromMonday = (vnNow.getUTCDay() + 6) % 7;
      const monday = new Date(vnNow.getTime() - dayFromMonday * DAY_MS);
      return { fromMs: vnStartOfDay(monday), toMs: nowMs };
    }
    case 'last_week': {
      const dayFromMonday = (vnNow.getUTCDay() + 6) % 7;
      const lastSunday = new Date(vnNow.getTime() - (dayFromMonday + 1) * DAY_MS);
      const lastMonday = new Date(lastSunday.getTime() - 6 * DAY_MS);
      return { fromMs: vnStartOfDay(lastMonday), toMs: vnEndOfDay(lastSunday) };
    }
    case 'this_month':
      return {
        fromMs: Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), 1) - VN_OFFSET_MS,
        toMs: nowMs,
      };
    case 'last_month':
      return {
        fromMs: Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth() - 1, 1) - VN_OFFSET_MS,
        toMs: Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), 1) - VN_OFFSET_MS - 1,
      };
    case 'this_year':
      return {
        fromMs: Date.UTC(vnNow.getUTCFullYear(), 0, 1) - VN_OFFSET_MS,
        toMs: nowMs,
      };
    case 'custom':
      return {
        fromMs: vnDateAtStart(query.dateFrom!),
        toMs: vnDateAtStart(query.dateTo!) + DAY_MS - 1,
      };
    default:
      return { fromMs: vnStartOfDay(vnNow), toMs: nowMs };
  }
}

export function resolveProductReportCompareRange(
  compareWith: ProductReportQueryInput['compareWith'],
  fromMs: number,
  toMs: number,
): { compareFromMs: number | null; compareToMs: number | null } {
  if (compareWith === 'none') return { compareFromMs: null, compareToMs: null };
  if (compareWith === 'same_period_last_week') {
    return { compareFromMs: fromMs - 7 * DAY_MS, compareToMs: toMs - 7 * DAY_MS };
  }
  if (compareWith === 'same_period_last_month') {
    return {
      compareFromMs: shiftVnTimestamp(fromMs, { months: -1 }),
      compareToMs: shiftVnTimestamp(toMs, { months: -1 }),
    };
  }
  if (compareWith === 'same_period_last_year') {
    return {
      compareFromMs: shiftVnTimestamp(fromMs, { years: -1 }),
      compareToMs: shiftVnTimestamp(toMs, { years: -1 }),
    };
  }

  const durationMs = toMs - fromMs + 1;
  const compareToMs = fromMs - 1;
  return { compareFromMs: compareToMs - durationMs + 1, compareToMs };
}

export function isTimestampInReportHour(timestamp: number, query: ProductReportQueryInput) {
  if (query.hourMode === 'all') return true;
  const fromMinutes = query.fromHour * 60 + query.fromMinute;
  const toMinutes = query.toHour * 60 + query.toMinute;
  if (fromMinutes === toMinutes) return true;

  const vnTime = new Date(timestamp + VN_OFFSET_MS);
  const value = vnTime.getUTCHours() * 60 + vnTime.getUTCMinutes();
  return fromMinutes < toMinutes
    ? value >= fromMinutes && value <= toMinutes
    : value >= fromMinutes || value <= toMinutes;
}

function lineQuantity(line: RawReportLineRow) {
  return line.quantityMilli / 1000;
}

export function allocateProductReportInvoiceDiscounts(lines: RawReportLineRow[]) {
  const invoiceGroups = new Map<string, RawReportLineRow[]>();
  for (const line of lines) {
    const group = invoiceGroups.get(line.invoiceId) ?? [];
    group.push(line);
    invoiceGroups.set(line.invoiceId, group);
  }

  const allocated: RawReportLineRow[] = [];
  for (const invoiceLines of invoiceGroups.values()) {
    const lineDiscountTotal = invoiceLines.reduce((sum, line) => sum + line.discountValue, 0);
    const allocationBase = invoiceLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const orderDiscount = Math.min(
      allocationBase,
      Math.max(0, invoiceLines[0]!.invoiceDiscountTotal - lineDiscountTotal),
    );
    let remainingDiscount = orderDiscount;
    let remainingBase = allocationBase;

    invoiceLines.forEach((line, index) => {
      const isLast = index === invoiceLines.length - 1;
      const lineOrderDiscount =
        remainingDiscount <= 0 || remainingBase <= 0
          ? 0
          : isLast
            ? remainingDiscount
            : Math.min(
                line.lineTotal,
                Math.round((remainingDiscount * line.lineTotal) / remainingBase),
              );
      remainingDiscount -= lineOrderDiscount;
      remainingBase -= line.lineTotal;
      allocated.push(
        Object.assign({}, line, {
          discountValue: line.discountValue + lineOrderDiscount,
          lineTotal: line.lineTotal - lineOrderDiscount,
        }),
      );
    });
  }
  return allocated;
}

function calculateGrowth(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function sumLines(lines: RawReportLineRow[]) {
  return lines.reduce(
    (totals, line) => {
      totals.quantity += lineQuantity(line);
      totals.gross += line.grossLineTotal;
      totals.discount += line.discountValue;
      totals.net += line.lineTotal;
      return totals;
    },
    { quantity: 0, gross: 0, discount: 0, net: 0 },
  );
}

export function buildProductReportSummary(
  lines: RawReportLineRow[],
  compareLines: RawReportLineRow[],
  compareWith: ProductReportQueryInput['compareWith'],
): ProductReportSummaryDto {
  const current = sumLines(lines);
  const previous = sumLines(compareLines);
  const comparison: ProductReportComparisonDto | null =
    compareWith === 'none' || compareLines.length === 0
      ? null
      : {
          quantityGrowth: calculateGrowth(current.quantity, previous.quantity),
          grossAmountGrowth: calculateGrowth(current.gross, previous.gross),
          discountGrowth: calculateGrowth(current.discount, previous.discount),
          netAmountGrowth: calculateGrowth(current.net, previous.net),
        };

  return {
    totalQuantity: Number(current.quantity.toFixed(3)),
    grossAmount: current.gross,
    discountAmount: current.discount,
    netAmount: current.net,
    taxAmount: 0,
    totalAmount: current.net,
    comparison,
  };
}

function buildCategoryRows(
  lines: RawReportLineRow[],
  totalQty: number,
  totalGross: number,
): ProductReportCategoryRow[] {
  const categories = new Map<
    string,
    {
      categoryId: string;
      categoryName: string;
      unitName: string;
      quantity: number;
      grossAmount: number;
      discountAmount: number;
      netAmount: number;
      products: Map<
        string,
        {
          productId: string;
          productCode: string;
          productName: string;
          unitName: string;
          quantity: number;
          grossAmount: number;
          discountAmount: number;
          netAmount: number;
        }
      >;
    }
  >();

  for (const line of lines) {
    const categoryKey = line.categoryId ?? `name:${line.categoryName}`;
    const category = categories.get(categoryKey) ?? {
      categoryId: line.categoryId ?? categoryKey,
      categoryName: line.categoryName || 'Chưa phân loại',
      unitName: line.unitName || 'Món',
      quantity: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      products: new Map(),
    };
    const quantity = lineQuantity(line);
    category.quantity += quantity;
    category.grossAmount += line.grossLineTotal;
    category.discountAmount += line.discountValue;
    category.netAmount += line.lineTotal;

    const product = category.products.get(line.productId) ?? {
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      unitName: line.unitName || 'Món',
      quantity: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
    };
    product.quantity += quantity;
    product.grossAmount += line.grossLineTotal;
    product.discountAmount += line.discountValue;
    product.netAmount += line.lineTotal;
    category.products.set(line.productId, product);
    categories.set(categoryKey, category);
  }

  return [...categories.values()]
    .map((category) => {
      const products: ProductReportCategoryProductItem[] = [...category.products.values()]
        .toSorted((left, right) => right.grossAmount - left.grossAmount)
        .map((product) =>
          Object.assign({}, product, {
            quantity: Number(product.quantity.toFixed(3)),
            taxAmount: 0,
            totalAmount: product.netAmount,
          }),
        );
      return {
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        unitName: category.unitName,
        quantity: Number(category.quantity.toFixed(3)),
        quantityRatio: totalQty > 0 ? Number(((category.quantity / totalQty) * 100).toFixed(1)) : 0,
        grossAmount: category.grossAmount,
        grossAmountRatio:
          totalGross > 0 ? Number(((category.grossAmount / totalGross) * 100).toFixed(1)) : 0,
        discountAmount: category.discountAmount,
        netAmount: category.netAmount,
        taxAmount: 0,
        totalAmount: category.netAmount,
        products,
      };
    })
    .toSorted((left, right) => right.grossAmount - left.grossAmount);
}

function buildTopSellingRows(
  lines: RawReportLineRow[],
  totalQty: number,
  totalGross: number,
): ProductReportTopSellingRow[] {
  const products = new Map<
    string,
    Omit<ProductReportTopSellingRow, 'rank' | 'quantityRatio' | 'grossAmountRatio' | 'averagePrice'>
  >();

  for (const line of lines) {
    const product = products.get(line.productId) ?? {
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      categoryName: line.categoryName,
      unitName: line.unitName || 'Món',
      quantity: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
    };
    product.quantity += lineQuantity(line);
    product.grossAmount += line.grossLineTotal;
    product.discountAmount += line.discountValue;
    product.netAmount += line.lineTotal;
    products.set(line.productId, product);
  }

  return [...products.values()]
    .toSorted((left, right) => right.grossAmount - left.grossAmount)
    .map((product, index) =>
      Object.assign({}, product, {
        rank: index + 1,
        quantity: Number(product.quantity.toFixed(3)),
        quantityRatio: totalQty > 0 ? Number(((product.quantity / totalQty) * 100).toFixed(1)) : 0,
        grossAmountRatio:
          totalGross > 0 ? Number(((product.grossAmount / totalGross) * 100).toFixed(1)) : 0,
        averagePrice: product.quantity > 0 ? Math.round(product.grossAmount / product.quantity) : 0,
      }),
    );
}

function buildChart(
  rows: ProductReportCategoryRow[],
  metric: 'grossAmount' | 'quantity',
): ProductReportChartSlice[] {
  const total = rows.reduce((sum, row) => sum + row[metric], 0);
  return rows.slice(0, 8).map((row, index) => ({
    key: row.categoryId,
    label: row.categoryName,
    value: row[metric],
    percentage: total > 0 ? Number(((row[metric] / total) * 100).toFixed(1)) : 0,
    color: PALETTE[index % PALETTE.length]!,
  }));
}

function filterLinesByHour(lines: RawReportLineRow[], query: ProductReportQueryInput) {
  return allocateProductReportInvoiceDiscounts(lines).filter(
    (line) => line.lineType === 'PRODUCT' && isTimestampInReportHour(line.issuedAt, query),
  );
}

function filterCancelledByHour(items: RawCancelledItemRow[], query: ProductReportQueryInput) {
  return items.filter((item) => isTimestampInReportHour(item.cancelledAt, query));
}

function sumCancelledItems(rows: RawCancelledItemRow[]) {
  return {
    quantity: rows.reduce((total, item) => total + item.quantityMilli / 1000, 0),
    amount: rows.reduce((total, item) => total + item.lineTotal, 0),
  };
}

function buildCancelledSummary(
  items: RawCancelledItemRow[],
  compareItems: RawCancelledItemRow[],
  compareWith: ProductReportQueryInput['compareWith'],
): ProductReportSummaryDto {
  const current = sumCancelledItems(items);
  const previous = sumCancelledItems(compareItems);
  const comparison =
    compareWith === 'none' || compareItems.length === 0
      ? null
      : {
          quantityGrowth: calculateGrowth(current.quantity, previous.quantity),
          grossAmountGrowth: calculateGrowth(current.amount, previous.amount),
          discountGrowth: 0,
          netAmountGrowth: calculateGrowth(current.amount, previous.amount),
        };
  return {
    totalQuantity: Number(current.quantity.toFixed(3)),
    grossAmount: current.amount,
    discountAmount: 0,
    netAmount: current.amount,
    taxAmount: 0,
    totalAmount: current.amount,
    comparison,
  };
}

export class OwnerProductReportService {
  private readonly repository: OwnerProductReportRepository;

  constructor(env: AppEnv['Bindings']) {
    this.repository = new OwnerProductReportRepository(env.DB);
  }

  async getProductReport(
    storeId: string,
    query: ProductReportQueryInput,
  ): Promise<ProductReportResponseDto> {
    const generatedAt = Date.now();
    const { fromMs, toMs } = resolveProductReportDateRange(query, generatedAt);
    const { compareFromMs, compareToMs } = resolveProductReportCompareRange(
      query.compareWith,
      fromMs,
      toMs,
    );
    const isCancelledReport = query.reportType === 'CANCELLED_ITEMS';
    const [currentLines, currentCancelled, compareLines, compareCancelled] = await Promise.all([
      isCancelledReport
        ? Promise.resolve([] as RawReportLineRow[])
        : this.repository.getInvoiceLineItems(storeId, fromMs, toMs),
      isCancelledReport
        ? this.repository.getCancelledItems(storeId, fromMs, toMs)
        : Promise.resolve([] as RawCancelledItemRow[]),
      !isCancelledReport && compareFromMs !== null && compareToMs !== null
        ? this.repository.getInvoiceLineItems(storeId, compareFromMs, compareToMs)
        : Promise.resolve([] as RawReportLineRow[]),
      isCancelledReport && compareFromMs !== null && compareToMs !== null
        ? this.repository.getCancelledItems(storeId, compareFromMs, compareToMs)
        : Promise.resolve([] as RawCancelledItemRow[]),
    ]);

    const lines = filterLinesByHour(currentLines, query);
    const comparisonLines = filterLinesByHour(compareLines, query);
    const cancelledItems = filterCancelledByHour(currentCancelled, query);
    const comparisonCancelledItems = filterCancelledByHour(compareCancelled, query);
    const summary = isCancelledReport
      ? buildCancelledSummary(cancelledItems, comparisonCancelledItems, query.compareWith)
      : buildProductReportSummary(lines, comparisonLines, query.compareWith);
    const categoryRows = buildCategoryRows(lines, summary.totalQuantity, summary.grossAmount);

    return {
      reportType: query.reportType,
      timeRange: query.timeRange,
      fromMs,
      toMs,
      compareFromMs,
      compareToMs,
      generatedAt,
      summary,
      chart: buildChart(categoryRows, 'grossAmount'),
      quantityChart: buildChart(categoryRows, 'quantity'),
      categoryRows,
      topSellingRows: buildTopSellingRows(lines, summary.totalQuantity, summary.grossAmount),
      modifierRows: [],
      comboRows: [],
      cancelledRows: cancelledItems.map((item) => ({
        id: item.id,
        productName: item.productName,
        categoryName: item.categoryName,
        unitName: item.unitName ?? 'Món',
        quantity: Number((item.quantityMilli / 1000).toFixed(3)),
        totalAmount: item.lineTotal,
        cancelReason: item.cancelReason,
        cancelledAt: item.cancelledAt,
        cancelledByName: item.cancelledByName,
      })),
    };
  }

  async getProductDetail(
    storeId: string,
    productId: string,
    query: ProductReportQueryInput,
  ): Promise<ProductReportDetailResponseDto> {
    const { fromMs, toMs } = resolveProductReportDateRange(query);
    const lines = filterLinesByHour(
      await this.repository.getInvoiceLineItems(storeId, fromMs, toMs),
      query,
    ).filter((line) => line.productId === productId);
    const firstLine = lines[0];
    if (!firstLine) {
      throw new AppError(
        'PRODUCT_REPORT_DETAIL_NOT_FOUND',
        'Không tìm thấy giao dịch mặt hàng.',
        404,
      );
    }

    const invoices = new Map<
      string,
      {
        invoiceId: string;
        referenceCode: string;
        issuedAt: number;
        orderType: 'DINE_IN' | 'TAKEAWAY';
        quantity: number;
        grossAmount: number;
        discountAmount: number;
        netAmount: number;
        taxAmount: number;
        totalAmount: number;
      }
    >();
    for (const line of lines) {
      const invoice = invoices.get(line.invoiceId) ?? {
        invoiceId: line.invoiceId,
        referenceCode: line.referenceCode,
        issuedAt: line.issuedAt,
        orderType: line.orderType,
        quantity: 0,
        grossAmount: 0,
        discountAmount: 0,
        netAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
      };
      invoice.quantity += lineQuantity(line);
      invoice.grossAmount += line.grossLineTotal;
      invoice.discountAmount += line.discountValue;
      invoice.netAmount += line.lineTotal;
      invoice.totalAmount += line.lineTotal;
      invoices.set(line.invoiceId, invoice);
    }

    return {
      productId,
      productCode: firstLine.productCode,
      productName: firstLine.productName,
      categoryName: firstLine.categoryName,
      unitName: firstLine.unitName ?? 'Món',
      fromMs,
      toMs,
      summary: buildProductReportSummary(lines, [], 'none'),
      rows: [...invoices.values()]
        .map((row) => Object.assign({}, row, { quantity: Number(row.quantity.toFixed(3)) }))
        .toSorted((left, right) => right.issuedAt - left.issuedAt),
    };
  }
}
