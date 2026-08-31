import type {
  RevenueReportBreakdownDto,
  RevenueReportQuery,
  RevenueReportResponseDto,
  RevenueReportTimelineGranularity,
  RevenueReportTimelineRowDto,
} from '@contracts/revenue-report';
import { AppError } from '@server/lib/app-error';
import {
  OwnerRevenueReportRepository,
  type RawRevenueCancelledOrderRow,
  type RawRevenueInvoiceRow,
} from '@server/repositories/owner-revenue-report-repository';
import type { AppEnv } from '@server/types';

const DAY_MS = 86_400_000;

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

export function addDateOnlyDays(dateOnly: string, days: number) {
  const parts = dateParts(dateOnly);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return dateOnlyFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function dateOnlyDayOfWeek(dateOnly: string) {
  const parts = dateParts(dateOnly);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function dateOnlyDiff(from: string, to: string) {
  const a = dateParts(from);
  const b = dateParts(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

export function getZonedParts(timestamp: number, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values['year']!,
    month: values['month']!,
    day: values['day']!,
    hour: values['hour']!,
    minute: values['minute']!,
  };
}

export function zonedDateTimeToTimestamp(
  dateOnly: string,
  minutesAfterMidnight: number,
  timezone: string,
) {
  const date = addDateOnlyDays(dateOnly, Math.floor(minutesAfterMidnight / 1_440));
  const normalizedMinutes = ((minutesAfterMidnight % 1_440) + 1_440) % 1_440;
  const parts = dateParts(date);
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(normalizedMinutes / 60),
    normalizedMinutes % 60,
  );
  let guess = target;
  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(guess, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const difference = target - actualAsUtc;
    if (difference === 0) break;
    guess += difference;
  }
  return guess;
}

function businessDateForTimestamp(timestamp: number, timezone: string, cutoffMinutes: number) {
  const parts = getZonedParts(timestamp, timezone);
  const localDate = dateOnlyFromParts(parts);
  return parts.hour * 60 + parts.minute < cutoffMinutes
    ? addDateOnlyDays(localDate, -1)
    : localDate;
}

export function resolveRevenueReportRange(
  query: RevenueReportQuery,
  timezone: string,
  cutoffMinutes: number,
  nowMs = Date.now(),
) {
  const businessToday = businessDateForTimestamp(nowMs, timezone, cutoffMinutes);
  let dateFrom = businessToday;
  let dateTo = businessToday;
  let capAtNow = true;

  if (query.timeRange === 'yesterday') {
    dateFrom = addDateOnlyDays(businessToday, -1);
    dateTo = dateFrom;
    capAtNow = false;
  } else if (query.timeRange === 'last_7_days') {
    dateFrom = addDateOnlyDays(businessToday, -6);
  } else if (query.timeRange === 'this_week') {
    const daysFromMonday = (dateOnlyDayOfWeek(businessToday) + 6) % 7;
    dateFrom = addDateOnlyDays(businessToday, -daysFromMonday);
  } else if (query.timeRange === 'last_week') {
    const daysFromMonday = (dateOnlyDayOfWeek(businessToday) + 6) % 7;
    dateTo = addDateOnlyDays(businessToday, -daysFromMonday - 1);
    dateFrom = addDateOnlyDays(dateTo, -6);
    capAtNow = false;
  } else if (query.timeRange === 'this_month') {
    dateFrom = `${businessToday.slice(0, 7)}-01`;
  } else if (query.timeRange === 'last_month') {
    const current = dateParts(`${businessToday.slice(0, 7)}-01`);
    const lastMonthEnd = new Date(Date.UTC(current.year, current.month - 1, 0));
    dateTo = dateOnlyFromParts({
      year: lastMonthEnd.getUTCFullYear(),
      month: lastMonthEnd.getUTCMonth() + 1,
      day: lastMonthEnd.getUTCDate(),
    });
    dateFrom = `${dateTo.slice(0, 7)}-01`;
    capAtNow = false;
  } else if (query.timeRange === 'this_year') {
    dateFrom = `${businessToday.slice(0, 4)}-01-01`;
  } else if (query.timeRange === 'custom') {
    dateFrom = query.dateFrom!;
    dateTo = query.dateTo!;
    capAtNow = false;
  }

  const fromMs = zonedDateTimeToTimestamp(dateFrom, cutoffMinutes, timezone);
  const boundaryToMs =
    zonedDateTimeToTimestamp(addDateOnlyDays(dateTo, 1), cutoffMinutes, timezone) - 1;
  return {
    dateFrom,
    dateTo,
    fromMs,
    toMs: capAtNow ? Math.min(boundaryToMs, nowMs) : boundaryToMs,
    dayCount: dateOnlyDiff(dateFrom, dateTo) + 1,
  };
}

export function isTimestampInRevenueReportHour(
  timestamp: number,
  query: RevenueReportQuery,
  timezone: string,
) {
  if (query.hourMode === 'all') return true;
  const from = query.fromHour * 60 + query.fromMinute;
  const to = query.toHour * 60 + query.toMinute;
  if (from === to) return true;
  const parts = getZonedParts(timestamp, timezone);
  const value = parts.hour * 60 + parts.minute;
  return from < to ? value >= from && value < to : value >= from || value < to;
}

function percentage(value: number, total: number) {
  return total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function buildBreakdown(
  invoices: RawRevenueInvoiceRow[],
  definitions: Array<{
    key: string;
    label: string;
    matches: (row: RawRevenueInvoiceRow) => boolean;
  }>,
): RevenueReportBreakdownDto[] {
  const total = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  return definitions.map((definition) => {
    const rows = invoices.filter(definition.matches);
    const amount = rows.reduce((sum, row) => sum + row.total, 0);
    return {
      key: definition.key,
      label: definition.label,
      invoiceCount: rows.length,
      amount,
      percentage: percentage(amount, total),
    };
  });
}

function emptyTimelineRow(key: string, label: string): RevenueReportTimelineRowDto {
  return {
    key,
    label,
    completedInvoiceCount: 0,
    cancelledOrderCount: 0,
    grossRevenue: 0,
    cancelledAmount: 0,
    discountAmount: 0,
    netRevenue: 0,
    averageRevenuePerInvoice: 0,
  };
}

function timelineGranularity(dayCount: number): RevenueReportTimelineGranularity {
  if (dayCount === 1) return 'hour';
  return dayCount <= 31 ? 'day' : 'month';
}

function formatDateLabel(dateOnly: string) {
  const parts = dateParts(dateOnly);
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

function buildTimeline(
  invoices: RawRevenueInvoiceRow[],
  cancelled: RawRevenueCancelledOrderRow[],
  input: {
    dateFrom: string;
    dateTo: string;
    dayCount: number;
    timezone: string;
    cutoffMinutes: number;
  },
) {
  const granularity = timelineGranularity(input.dayCount);
  const rows = new Map<string, RevenueReportTimelineRowDto>();
  if (granularity === 'hour') {
    for (let hour = 0; hour < 24; hour += 1) {
      const key = String(hour).padStart(2, '0');
      rows.set(key, emptyTimelineRow(key, `${key}:00`));
    }
  } else {
    for (let offset = 0; offset < input.dayCount; offset += 1) {
      const date = addDateOnlyDays(input.dateFrom, offset);
      const key = granularity === 'day' ? date : date.slice(0, 7);
      if (!rows.has(key)) {
        rows.set(key, emptyTimelineRow(key, granularity === 'day' ? formatDateLabel(date) : key));
      }
    }
  }

  const keyForTimestamp = (timestamp: number) => {
    if (granularity === 'hour') {
      return String(getZonedParts(timestamp, input.timezone).hour).padStart(2, '0');
    }
    const date = businessDateForTimestamp(timestamp, input.timezone, input.cutoffMinutes);
    return granularity === 'day' ? date : date.slice(0, 7);
  };

  for (const invoice of invoices) {
    const row = rows.get(keyForTimestamp(invoice.issuedAt));
    if (!row) continue;
    row.completedInvoiceCount += 1;
    row.grossRevenue += invoice.subtotal;
    row.discountAmount += invoice.discountTotal;
    row.netRevenue += invoice.total;
  }
  for (const order of cancelled) {
    const row = rows.get(keyForTimestamp(order.cancelledAt));
    if (!row) continue;
    row.cancelledOrderCount += 1;
    row.cancelledAmount += order.total;
  }
  for (const row of rows.values()) {
    row.averageRevenuePerInvoice =
      row.completedInvoiceCount > 0 ? Math.round(row.netRevenue / row.completedInvoiceCount) : 0;
  }
  return { granularity, rows: [...rows.values()] };
}

export class OwnerRevenueReportService {
  private readonly repository: OwnerRevenueReportRepository;

  constructor(env: AppEnv['Bindings']) {
    this.repository = new OwnerRevenueReportRepository(env.DB);
  }

  async getRevenueReport(
    storeId: string,
    query: RevenueReportQuery,
    nowMs = Date.now(),
  ): Promise<RevenueReportResponseDto> {
    const settings = await this.repository.getStoreSettings(storeId);
    if (!settings) throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    const timezone = settings.timezone || 'Asia/Ho_Chi_Minh';
    const cutoffMinutes = Math.max(0, Math.min(1_439, settings.businessDayCutoffMinutes ?? 0));
    const range = resolveRevenueReportRange(query, timezone, cutoffMinutes, nowMs);
    const [rawInvoices, rawInvoiceLines, rawCancelled] = await Promise.all([
      this.repository.getCompletedInvoices(storeId, range.fromMs, range.toMs),
      this.repository.getInvoiceLines(storeId, range.fromMs, range.toMs),
      this.repository.getCancelledOrders(storeId, range.fromMs, range.toMs),
    ]);
    const matchesHour = (timestamp: number) =>
      isTimestampInRevenueReportHour(timestamp, query, timezone);
    const hourInvoices = rawInvoices.filter((row) => matchesHour(row.issuedAt));
    const staffOptions = Array.from(
      new Map(
        hourInvoices.map((row) => [
          row.issuedBy,
          { userId: row.issuedBy, displayName: row.staffName, roleName: row.roleName },
        ]),
      ).values(),
    ).toSorted((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
    const invoices = query.employeeId
      ? hourInvoices.filter((row) => row.issuedBy === query.employeeId)
      : hourInvoices;
    const invoiceIds = new Set(invoices.map((row) => row.id));
    const invoiceLines = rawInvoiceLines.filter(
      (row) => matchesHour(row.issuedAt) && invoiceIds.has(row.invoiceId),
    );
    const productLines = invoiceLines.filter((row) => row.lineType === 'PRODUCT');
    const cancelled = rawCancelled.filter((row) => matchesHour(row.cancelledAt));

    const productQuantity = productLines.reduce((sum, row) => sum + row.quantityMilli / 1_000, 0);
    const grossRevenue = invoices.reduce((sum, row) => sum + row.subtotal, 0);
    const timeRevenue = Math.min(
      grossRevenue,
      invoiceLines
        .filter((row) => row.lineType === 'TIME')
        .reduce((sum, row) => sum + row.grossAmount, 0),
    );
    const goodsRevenue = Math.max(0, grossRevenue - timeRevenue);
    const discountAmount = invoices.reduce((sum, row) => sum + row.discountTotal, 0);
    const netRevenue = invoices.reduce((sum, row) => sum + row.total, 0);
    const cancelledAmount = cancelled.reduce((sum, row) => sum + row.total, 0);
    const completedInvoiceCount = invoices.length;
    const staffRevenue = Array.from(
      invoices
        .reduce((groups, invoice) => {
          const current = groups.get(invoice.issuedBy) ?? {
            userId: invoice.issuedBy,
            key: invoice.issuedBy,
            label: invoice.staffName,
            roleName: invoice.roleName,
            invoiceCount: 0,
            amount: 0,
            percentage: 0,
          };
          current.invoiceCount += 1;
          current.amount += invoice.total;
          groups.set(invoice.issuedBy, current);
          return groups;
        }, new Map<string, import('@contracts/revenue-report').RevenueReportStaffRowDto>())
        .values(),
    )
      .map((row) => ({ ...row, percentage: percentage(row.amount, netRevenue) }))
      .toSorted((a, b) => b.amount - a.amount);

    const hourlyAverage = Array.from({ length: 24 }, (_, hour) => {
      const hourRows = invoices.filter(
        (row) => getZonedParts(row.issuedAt, timezone).hour === hour,
      );
      return {
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        averageRevenue: Math.round(
          hourRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, range.dayCount),
        ),
        invoiceCount: hourRows.length,
      };
    });
    const timeline = buildTimeline(invoices, cancelled, {
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      dayCount: range.dayCount,
      timezone,
      cutoffMinutes,
    });
    const rawSummary = {
      completedInvoiceCount,
      cancelledOrderCount: cancelled.length,
      productQuantity: Number(productQuantity.toFixed(3)),
      goodsRevenue,
      timeRevenue,
      grossRevenue,
      cancelledAmount,
      discountAmount,
      netRevenue,
      averageItemsPerInvoice:
        completedInvoiceCount > 0
          ? Number((productQuantity / completedInvoiceCount).toFixed(2))
          : 0,
      averageRevenuePerInvoice:
        completedInvoiceCount > 0 ? Math.round(netRevenue / completedInvoiceCount) : 0,
    };
    const cancellationOnly = query.reportType === 'CANCELLATIONS';

    return {
      reportType: query.reportType,
      selectedEmployeeId: query.employeeId ?? null,
      timeRange: query.timeRange,
      timezone,
      businessDayCutoffMinutes: cutoffMinutes,
      fromMs: range.fromMs,
      toMs: range.toMs,
      generatedAt: nowMs,
      dayCount: range.dayCount,
      timelineGranularity: timeline.granularity,
      summary: cancellationOnly
        ? {
            ...rawSummary,
            completedInvoiceCount: 0,
            productQuantity: 0,
            goodsRevenue: 0,
            timeRevenue: 0,
            grossRevenue: 0,
            discountAmount: 0,
            netRevenue: 0,
            averageItemsPerInvoice: 0,
            averageRevenuePerInvoice: 0,
          }
        : rawSummary,
      hourlyAverage: cancellationOnly ? [] : hourlyAverage,
      timeline: query.reportType === 'OVERVIEW' ? timeline.rows : [],
      paymentMethods:
        query.reportType === 'PAYMENT_METHOD'
          ? buildBreakdown(invoices, [
              { key: 'CASH', label: 'Tiền mặt', matches: (row) => row.method === 'CASH' },
              {
                key: 'BANK_TRANSFER',
                label: 'Chuyển khoản / QR',
                matches: (row) => row.method === 'BANK_TRANSFER',
              },
              {
                key: 'OTHER',
                label: 'Khác',
                matches: (row) => row.method !== 'CASH' && row.method !== 'BANK_TRANSFER',
              },
            ])
          : [],
      orderTypes:
        query.reportType === 'SERVICE_MODE'
          ? buildBreakdown(invoices, [
              { key: 'DINE_IN', label: 'Tại bàn', matches: (row) => row.orderType === 'DINE_IN' },
              { key: 'TAKEAWAY', label: 'Mang về', matches: (row) => row.orderType === 'TAKEAWAY' },
            ])
          : [],
      staffRevenue: query.reportType === 'STAFF_REVENUE' ? staffRevenue : [],
      staffOptions: query.reportType === 'STAFF_REVENUE' ? staffOptions : [],
      cancellations:
        query.reportType === 'CANCELLATIONS'
          ? cancelled.map((row) => ({
              id: row.id,
              cancelledAt: row.cancelledAt,
              amount: row.total,
              orderType: row.orderType,
              cancelledByName: row.cancelledByName,
              reason: row.reason,
            }))
          : [],
    };
  }
}
