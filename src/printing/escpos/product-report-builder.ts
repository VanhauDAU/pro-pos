import type { ProductReportPrintSnapshotDto } from '@contracts/reports';
import type { PaperSize } from '@contracts/store';
import { ESC_POS } from './escpos-commands';
import { encodeWpc1258 } from './escpos-wpc1258';
import { padRow, removeVietnameseDiacritics, wrapTextToWidth } from './escpos-text-builder';

export interface EscPosProductReportOptions {
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

function formatTimestamp(value: number, timezone = 'Asia/Ho_Chi_Minh') {
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

export function buildEscPosProductReport(
  snapshot: ProductReportPrintSnapshotDto,
  options: EscPosProductReportOptions,
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
  const currency = mode === 'UNACCENTED' ? 'd' : 'đ';

  const reportTitle =
    {
      CATEGORY: 'BAO CAO THEO DANH MUC',
      TOP_SELLING: 'MAT HANG BAN CHAY',
      CANCELLED_ITEMS: 'MAT HANG DA HUY',
      MODIFIER_CATEGORY: 'BAO CAO TOPPING',
      TOP_COMBO: 'BAO CAO COMBO',
      CANCELLED_COMBOS: 'COMBO DA HUY',
    }[report.reportType] || 'BAO CAO MAT HANG';

  // 1. Header
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
  wrapped(`Tu: ${formatTimestamp(report.fromMs)}`);
  wrapped(`Den: ${formatTimestamp(report.toMs)}`);
  wrapped(`Nguoi in: ${snapshot.requestedByName}`);
  wrapped(`Tao luc: ${formatTimestamp(snapshot.createdAt)}`);
  line(divider);

  // 2. Summary
  pair('Tong so luong', formatQuantity(report.summary.totalQuantity));
  pair('Tien hang', formatMoney(report.summary.grossAmount, currency));
  if (report.summary.discountAmount > 0) {
    pair('Giam gia', formatMoney(report.summary.discountAmount, currency));
  }
  parts.push(ESC_POS.boldOn);
  pair('DOANH THU THUAN', formatMoney(report.summary.netAmount, currency));
  parts.push(ESC_POS.boldOff);

  // 3. Breakdown by report type
  if (report.reportType === 'CATEGORY' && report.categoryRows?.length) {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('CHI TIET THEO DANH MUC');
    parts.push(ESC_POS.boldOff);
    for (const cat of report.categoryRows) {
      line();
      parts.push(ESC_POS.boldOn);
      pair(`[${cat.categoryName}]`, formatMoney(cat.netAmount, currency));
      parts.push(ESC_POS.boldOff);
      pair(
        `  SL: ${formatQuantity(cat.quantity)}`,
        `Giam: ${formatMoney(cat.discountAmount, currency)}`,
      );
      for (const prod of cat.products) {
        wrapped(`  * ${prod.productName} (${prod.unitName})`);
        pair(`    SL: ${formatQuantity(prod.quantity)}`, formatMoney(prod.netAmount, currency));
      }
    }
  } else if (report.reportType === 'TOP_SELLING' && report.topSellingRows?.length) {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('TOP MAT HANG BAN CHAY');
    parts.push(ESC_POS.boldOff);
    for (const prod of report.topSellingRows.slice(0, 30)) {
      wrapped(`#${prod.rank}. ${prod.productName} (${prod.unitName})`);
      pair(`  SL: ${formatQuantity(prod.quantity)}`, formatMoney(prod.netAmount, currency));
    }
  } else if (report.reportType === 'CANCELLED_ITEMS' && report.cancelledRows?.length) {
    line(divider);
    parts.push(ESC_POS.boldOn);
    line('CHI TIET MAT HANG DA HUY');
    parts.push(ESC_POS.boldOff);
    for (const item of report.cancelledRows.slice(0, 30)) {
      wrapped(`* ${item.productName} (${item.unitName})`);
      pair(`  SL huy: ${formatQuantity(item.quantity)}`, formatMoney(item.totalAmount, currency));
      if (item.cancelReason) wrapped(`  Ly do: ${item.cancelReason}`);
      wrapped(`  Boi: ${item.cancelledByName} · ${formatTimestamp(item.cancelledAt)}`);
    }
  }

  // 4. Footer & Cut
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
