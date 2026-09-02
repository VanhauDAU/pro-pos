import type { RevenueReportPrintSnapshotDto } from '@contracts/revenue-report';
import type { PaperSize } from '@contracts/store';
import { ESC_POS } from './escpos-commands';
import { encodeWpc1258 } from './escpos-wpc1258';
import { padRow, removeVietnameseDiacritics, wrapTextToWidth } from './escpos-text-builder';

export interface EscPosRevenueReportOptions {
  paperSize: PaperSize;
  autoCut: boolean;
  storeName?: string | null;
  storeAddress?: string | null;
  storePhone?: string | null;
  vietnameseMode?: 'WPC1258' | 'UNACCENTED' | 'UTF8';
}

function formatMoney(value: number, currency: string) {
  return `${Math.round(value).toLocaleString('vi-VN')}${currency}`;
}

function formatQuantity(value: number) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
}

function formatTimestamp(value: number, timezone: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function buildEscPosRevenueReport(
  snapshot: RevenueReportPrintSnapshotDto,
  options: EscPosRevenueReportOptions,
) {
  const width = options.paperSize === 'K58' ? 32 : 48;
  const divider = '-'.repeat(width);
  const mode = options.vietnameseMode ?? 'UNACCENTED';
  const sanitize = (value: string | null | undefined) => {
    const text = value ?? '';
    return mode === 'UNACCENTED' ? removeVietnameseDiacritics(text) : text;
  };
  const encoder = new TextEncoder();
  const encode = (value: string) =>
    mode === 'WPC1258' ? encodeWpc1258(value) : encoder.encode(value);
  const parts: Uint8Array[] = [ESC_POS.initialize, ESC_POS.selectFontA];
  if (mode === 'WPC1258') parts.push(Uint8Array.of(0x1b, 0x74, 52));
  const line = (value = '') => parts.push(encode(`${sanitize(value)}\n`));
  const pair = (left: string, right: string) =>
    line(padRow(sanitize(left), sanitize(right), width));
  const wrapped = (value: string) => wrapTextToWidth(sanitize(value), width).forEach(line);
  const report = snapshot.report;
  const timeRevenue = report.summary.timeRevenue ?? 0;
  const goodsRevenue =
    report.summary.goodsRevenue ?? Math.max(0, report.summary.grossRevenue - timeRevenue);
  const currency = mode === 'UNACCENTED' ? 'd' : 'đ';
  const reportTitle = {
    OVERVIEW: 'DOANH THU TONG QUAN',
    PAYMENT_METHOD: 'PHUONG THUC THANH TOAN',
    SERVICE_MODE: 'HINH THUC PHUC VU',
    CANCELLATIONS: 'BAO CAO HUY DON',
    STAFF_REVENUE: 'DOANH THU NHAN VIEN',
  }[report.reportType];

  parts.push(ESC_POS.alignCenter, ESC_POS.boldOn, ESC_POS.doubleHeightOn);
  wrapped((options.storeName || 'PRO POS').toUpperCase());
  parts.push(ESC_POS.resetSize, ESC_POS.boldOff);
  if (options.storeAddress) wrapped(options.storeAddress);
  if (options.storePhone) line(`SDT: ${options.storePhone}`);
  line();
  parts.push(ESC_POS.boldOn, ESC_POS.doubleHeightOn);
  line(reportTitle);
  parts.push(ESC_POS.resetSize, ESC_POS.boldOff, ESC_POS.alignLeft);
  line(divider);
  wrapped(`Tu: ${formatTimestamp(report.fromMs, report.timezone)}`);
  wrapped(`Den: ${formatTimestamp(report.toMs, report.timezone)}`);
  wrapped(`Nguoi in: ${snapshot.requestedByName}`);
  if (report.selectedEmployeeId) {
    const selected = report.staffOptions.find(
      (staff) => staff.userId === report.selectedEmployeeId,
    );
    if (selected) wrapped(`Nhan vien: ${selected.displayName}`);
  }
  wrapped(`Tao luc: ${formatTimestamp(snapshot.createdAt, report.timezone)}`);
  line(divider);

  pair('Hoa don hoan tat', String(report.summary.completedInvoiceCount));
  if (report.reportType === 'OVERVIEW' || report.reportType === 'CANCELLATIONS') {
    pair('Don huy', String(report.summary.cancelledOrderCount));
  }
  if (report.reportType === 'OVERVIEW') {
    pair('So luong mat hang', formatQuantity(report.summary.productQuantity));
    pair('TB mat hang/HD', formatQuantity(report.summary.averageItemsPerInvoice));
  }
  pair('TB doanh thu/HD', formatMoney(report.summary.averageRevenuePerInvoice, currency));
  line(divider);
  pair('Tien hang', formatMoney(goodsRevenue, currency));
  pair('Tien gio', formatMoney(timeRevenue, currency));
  pair('Tong truoc giam', formatMoney(report.summary.grossRevenue, currency));
  pair('Tien huy', formatMoney(report.summary.cancelledAmount, currency));
  pair('Giam gia', formatMoney(report.summary.discountAmount, currency));
  parts.push(ESC_POS.boldOn);
  pair('DOANH THU THUAN', formatMoney(report.summary.netRevenue, currency));
  parts.push(ESC_POS.boldOff);

  if (report.reportType === 'PAYMENT_METHOD') {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('PHUONG THUC THANH TOAN');
    parts.push(ESC_POS.boldOff);
    for (const row of report.paymentMethods) {
      if (row.invoiceCount || row.amount)
        pair(`${row.label} (${row.invoiceCount})`, formatMoney(row.amount, currency));
    }
  }
  if (report.reportType === 'SERVICE_MODE') {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('HINH THUC PHUC VU');
    parts.push(ESC_POS.boldOff);
    for (const row of report.orderTypes) {
      if (row.invoiceCount || row.amount)
        pair(`${row.label} (${row.invoiceCount})`, formatMoney(row.amount, currency));
    }
  }
  if (report.reportType === 'STAFF_REVENUE') {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('DOANH THU THEO NHAN VIEN');
    parts.push(ESC_POS.boldOff);
    for (const row of report.staffRevenue)
      pair(`${row.label} (${row.invoiceCount})`, formatMoney(row.amount, currency));
  }
  if (report.reportType === 'CANCELLATIONS') {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('CHI TIET HUY DON');
    parts.push(ESC_POS.boldOff);
    for (const row of report.cancellations.slice(0, 20)) {
      pair(formatTimestamp(row.cancelledAt, report.timezone), formatMoney(row.amount, currency));
      wrapped(`  ${row.cancelledByName}: ${row.reason}`);
    }
  }

  const timeline = report.timeline.filter(
    (row) => row.completedInvoiceCount > 0 || row.cancelledOrderCount > 0,
  );
  if (timeline.length > 0 && report.reportType === 'OVERVIEW') {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line(
      `CHI TIET THEO ${report.timelineGranularity === 'hour' ? 'GIO' : report.timelineGranularity === 'day' ? 'NGAY' : 'THANG'}`,
    );
    parts.push(ESC_POS.boldOff);
    for (const row of timeline) {
      pair(`${row.label} (${row.completedInvoiceCount} HD)`, formatMoney(row.netRevenue, currency));
      if (row.cancelledOrderCount > 0) {
        pair(`  Huy: ${row.cancelledOrderCount}`, formatMoney(row.cancelledAmount, currency));
      }
    }
  }

  line(divider);
  parts.push(ESC_POS.alignCenter);
  line('Bao cao chi tinh hoa don hoan tat');
  parts.push(ESC_POS.alignLeft, ESC_POS.feedFourLines);
  if (options.autoCut) parts.push(ESC_POS.cut);

  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
