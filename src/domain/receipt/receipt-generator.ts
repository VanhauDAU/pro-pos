import {
  type PaperSize,
  type StorePrintSettings,
  getReceiptPrintProfile,
  parsePrinterDeviceConfig,
} from '@contracts/store';
import { createReceiptDocument } from './receipt-document';

export interface PosReceiptTimeSegment {
  name: string;
  type?: 'BASE' | 'FIRST_PERIOD' | 'SPECIAL' | string | undefined;
  startedAtMs: number;
  endedAtMs: number | null | undefined;
  elapsedSeconds: number;
  priceVnd: number;
  amount: number;
}

export function compactReceiptTimeSegments(
  segments: PosReceiptTimeSegment[] | undefined,
): PosReceiptTimeSegment[] | undefined {
  if (!segments || segments.length < 2) return segments;
  const compacted: PosReceiptTimeSegment[] = [];
  for (const segment of segments) {
    const previous = compacted.at(-1);
    if (
      previous &&
      previous.type === segment.type &&
      previous.name === segment.name &&
      previous.priceVnd === segment.priceVnd
    ) {
      previous.endedAtMs = segment.endedAtMs;
      previous.elapsedSeconds += segment.elapsedSeconds;
      previous.amount += segment.amount;
    } else {
      compacted.push({ ...segment });
    }
  }
  return compacted;
}

/** Makes displayed segment amounts add up exactly to the finalized rounded time total. */
export function reconcileReceiptTimeSegmentAmounts(
  segments: PosReceiptTimeSegment[] | undefined,
  roundedTotal: number,
): PosReceiptTimeSegment[] | undefined {
  if (!segments?.length) return segments;
  const reconciled = segments.map((segment) => ({
    ...segment,
    amount: Math.max(0, Math.round(segment.amount)),
  }));
  const target = Math.max(0, Math.round(roundedTotal));
  let difference = target - reconciled.reduce((sum, segment) => sum + segment.amount, 0);
  if (difference >= 0) {
    reconciled[reconciled.length - 1]!.amount += difference;
    return reconciled;
  }

  for (let index = reconciled.length - 1; index >= 0 && difference < 0; index -= 1) {
    const segment = reconciled[index]!;
    const reduction = Math.min(segment.amount, -difference);
    segment.amount -= reduction;
    difference += reduction;
  }
  return reconciled;
}

export interface PosReceiptLineItem {
  id: string;
  name: string;
  /** Selected price/variant name captured when the item was added. */
  priceName?: string | null | undefined;
  /** Number of active price variants for the product. One (or fewer) stays implicit. */
  priceVariantCount?: number | undefined;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discountAmount?: number | undefined;
  discountReason?: string | null | undefined;
  adjustmentSource?: 'MANUAL' | 'PROMOTION_GIFT' | undefined;
  promotionName?: string | null | undefined;
  note?: string | null | undefined;
  unitName?: string | null | undefined;
  isTime?: boolean | undefined;
  timeStartedAtMs?: number | undefined;
  timeEndedAtMs?: number | null | undefined;
  timeElapsedSeconds?: number | undefined;
  timeSegments?: PosReceiptTimeSegment[] | undefined;
  tableSegments?:
    | Array<{
        tableName: string;
        startedAtMs: number;
        endedAtMs: number | null | undefined;
        elapsedSeconds: number;
        amount: number;
        hourlyPrice?: number | undefined;
      }>
    | undefined;
}

export function formatReceiptLineName(
  line: Pick<PosReceiptLineItem, 'name' | 'priceName' | 'priceVariantCount'>,
  showItemPriceName: boolean,
): string {
  const priceName = line.priceName?.trim();
  if (!showItemPriceName || !priceName || (line.priceVariantCount ?? 0) <= 1) {
    return line.name;
  }
  return `${line.name} (${priceName})`;
}

export interface PosReceiptPromotion {
  name: string;
  type: string;
  value: number | null;
  discountAmountVnd: number;
  flatPriceItems?: Array<{
    productName: string;
    variantName: string | null;
    quantityMilli: number;
    originalUnitPriceVnd: number;
    flatUnitPriceVnd: number;
    discountAmountVnd: number;
  }>;
}

export interface PosReceiptPrintData {
  receiptType: 'PROVISIONAL' | 'PAYMENT' | 'DEBT_PAYMENT';
  orderCode: string;
  invoiceCode?: string | null | undefined;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  tableName?: string | null | undefined;
  areaName?: string | null | undefined;
  cashierName?: string | null | undefined;
  customerName?: string | null | undefined;
  guestPhone?: string | null | undefined;
  guestAddress?: string | null | undefined;
  note?: string | null | undefined;
  checkInTimeMs?: number | null | undefined;
  issuedAtMs: number;
  subtotal: number;
  discountTotal: number;
  promotionDiscount?: number | undefined;
  promotion?: PosReceiptPromotion | null | undefined;
  promotions?: PosReceiptPromotion[] | undefined;
  total: number;
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | null | undefined;
  cashReceived?: number | null | undefined;
  cashChange?: number | null | undefined;
  paymentAllocations?:
    Array<{ method: 'CASH' | 'BANK_TRANSFER' | 'DEBT'; amountVnd: number }> | undefined;
  paidAmountVnd?: number | undefined;
  debtAmountVnd?: number | undefined;
  debtBeforeVnd?: number | undefined;
  debtPaymentVnd?: number | undefined;
  debtAfterVnd?: number | undefined;
  referenceCode?: string | null | undefined;
  lines: PosReceiptLineItem[];
}

export interface PosReceiptPrintOptions {
  data: PosReceiptPrintData;
  printSettings?: StorePrintSettings | null | undefined;
  storeInfo?:
    | {
        storeName?: string | null | undefined;
        phone?: string | null | undefined;
        address?: string | null | undefined;
        bankName?: string | null | undefined;
        bankAccountNumber?: string | null | undefined;
        bankAccountName?: string | null | undefined;
      }
    | null
    | undefined;
}

function formatVnd(val: number): string {
  return new Intl.NumberFormat('vi-VN').format(val);
}

function formatDateTime(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  const SS = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}${withSeconds ? `:${SS}` : ''}`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? `${m}p` : ''}`;
  return `${m} phút`;
}

export function formatDateOnly(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatTimeOnly(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  const SS = String(d.getSeconds()).padStart(2, '0');
  return `${HH}:${MM}${withSeconds ? `:${SS}` : ''}`;
}

export function formatSegmentDurationLabel(seg: {
  name: string;
  type?: string | undefined;
  elapsedSeconds: number;
}): string {
  if (seg.type === 'FIRST_PERIOD' || seg.name === 'Giờ đầu tiên' || seg.name === 'Giờ đầu') {
    return '=Giờ đầu';
  }
  const h = Math.floor(seg.elapsedSeconds / 3600);
  const m = Math.floor((seg.elapsedSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `=${h} giờ ${m} phút`;
  if (h > 0) return `=${h} giờ`;
  if (m === 0) return `=${Math.max(0, seg.elapsedSeconds)} giây`;
  return `=${m} phút`;
}

/**
 * Generates raw ESC/POS commands from formatted order/invoice data according to the store's profile & template settings.
 */
export function buildEscPosReceipt(
  options: PosReceiptPrintOptions,
  copy?: { index: number; total: number },
): {
  escPosData: string;
  paperSize: PaperSize;
  autoCut: boolean;
  openCashDrawer: boolean;
} {
  const document = createReceiptDocument(options);
  const { data, template } = document;
  const printSettings = options.printSettings;

  const printerConfig = parsePrinterDeviceConfig(printSettings?.printersJson);
  const paperSize: PaperSize = printSettings?.paperSize || printerConfig.paperSize || 'K80';
  const profile = getReceiptPrintProfile(paperSize, printerConfig.printableDots);
  const chars = profile.charsPerLineFontA;
  const divider = '-'.repeat(chars);

  const escInit = '\x1B\x40';
  const escFontA = '\x1B\x4D\x00';
  const escCenter = '\x1B\x61\x01';
  const escLeft = '\x1B\x61\x00';
  const escBoldOn = '\x1B\x45\x01';
  const escBoldOff = '\x1B\x45\x00';
  const escCut = '\x1D\x56\x41\x00';
  const escDrawer = '\x1B\x70\x00\x19\xFA';

  // Do not inherit Font B/C from a previous print job.
  let raw = escInit + escFontA;

  // 1. Header (Store Name, Address, Phone)
  const storeName = document.store.name;
  const storeAddress = document.store.address;
  const storePhone = document.store.phone;

  raw += escCenter;
  if (storeName) raw += escBoldOn + storeName.toUpperCase() + '\n' + escBoldOff;
  if (storeAddress) raw += storeAddress + '\n';
  if (storePhone) raw += `SĐT: ${storePhone}\n`;

  // 2. Receipt Title
  const title =
    data.receiptType === 'PROVISIONAL'
      ? 'HÓA ĐƠN TẠM TÍNH'
      : data.receiptType === 'DEBT_PAYMENT'
        ? 'PHIẾU THU CÔNG NỢ'
        : 'HÓA ĐƠN THANH TOÁN';
  raw += '\n' + escBoldOn + title + '\n' + escBoldOff;
  raw += `Liên ${copy?.index ?? 1}/${copy?.total ?? 1}\n`;
  const code = data.invoiceCode || data.orderCode;
  raw += `Số: ${code}\n`;
  raw += `Ngày: ${formatDateTime(data.issuedAtMs)}\n`;

  raw += escLeft + divider + '\n';

  // 3. Meta information
  if (template.showTableAreaName && (data.tableName || data.areaName)) {
    const tableArea = [data.tableName, data.areaName].filter(Boolean).join(' · ');
    raw += `Khu vực / Bàn: ${tableArea}\n`;
  }
  if (template.showCashierName && data.cashierName) {
    raw += `Thu ngân     : ${data.cashierName}\n`;
  }
  if (template.showCheckInTime && data.checkInTimeMs) {
    raw += `Giờ vào      : ${formatDateTime(data.checkInTimeMs)}\n`;
  }
  if (template.showCustomerName) {
    raw += `Khách hàng   : ${data.customerName?.trim() || 'Khách lẻ'}\n`;
  }
  if (template.showCustomerPhone && data.guestPhone) {
    raw += `SĐT Khách    : ${data.guestPhone}\n`;
  }
  if (template.showCustomerAddress && data.guestAddress) {
    raw += `Địa chỉ Khách: ${data.guestAddress}\n`;
  }
  if (template.showOrderNote && data.note) {
    raw += `Ghi chú      : ${data.note}\n`;
  }

  raw += divider + '\n';

  const timeLines = data.lines.filter((l) => l.isTime);
  const productLines = data.lines.filter((l) => !l.isTime);
  const timeTotal = timeLines.reduce((sum, line) => sum + line.totalPrice, 0);
  const goodsTotal = productLines.reduce((sum, line) => sum + line.totalPrice, 0);

  // 4. Section: Hourly Services (Thông tin giờ)
  if (timeLines.length > 0) {
    if (profile.layoutMode === 'MULTI_COLUMN') {
      raw += template.showHourlyUnitPrice
        ? `${'Thông tin giờ'.padEnd(26)} ${'Đ.Giá'.padStart(9)} ${'T.Tiền'.padStart(11)}\n`
        : `${'Thông tin giờ'.padEnd(35)} ${'T.Tiền'.padStart(12)}\n`;
      raw += divider + '\n';
    } else {
      raw += 'Thông tin giờ              T.Tiền\n';
      raw += divider + '\n';
    }

    for (const line of timeLines) {
      if (
        line.tableSegments &&
        line.tableSegments.length > 1 &&
        (!line.timeSegments || line.timeSegments.length === 0)
      ) {
        raw += `Chuyển bàn\n`;
        if (template.showHourlyDetail) {
          for (const tSeg of line.tableSegments) {
            const segName = ` - ${tSeg.tableName}`;
            const segTime = ` (${formatDuration(tSeg.elapsedSeconds)})`;
            const segAmount = formatVnd(tSeg.amount);
            raw += `   ${segName}${segTime} : ${segAmount}\n`;
          }
        }
        raw += `   Tổng tiền giờ: ${formatVnd(line.totalPrice)}\n`;
        continue;
      }

      if (
        template.showHourlyDetail &&
        template.hourlyDetailMode === 'FULL_TIMELOG' &&
        line.timeSegments &&
        line.timeSegments.length > 0
      ) {
        for (const seg of reconcileReceiptTimeSegmentAmounts(line.timeSegments, line.totalPrice) ??
          []) {
          const startStr = formatTimeOnly(seg.startedAtMs, template.showHourlyTimeWithSeconds);
          const endStr = seg.endedAtMs
            ? formatTimeOnly(seg.endedAtMs, template.showHourlyTimeWithSeconds)
            : 'Hiện tại';
          const timeRange = `${startStr} - ${endStr}`;
          const dateStr = formatDateOnly(seg.startedAtMs);
          const durLabel = formatSegmentDurationLabel(seg);
          const priceStr = `${formatVnd(seg.priceVnd)}${template.showHourlyUnitDuration ? '/1h' : ''}`;
          const totalStr = formatVnd(seg.amount);

          if (profile.layoutMode === 'MULTI_COLUMN') {
            if (template.showHourlyUnitPrice) {
              const leftCol1 = timeRange.padEnd(26).slice(0, 26);
              const priceCol1 = priceStr.padStart(9).slice(-9);
              const totCol1 = totalStr.padStart(11).slice(-11);
              raw += `${leftCol1} ${priceCol1} ${totCol1}\n`;

              const leftCol2 = `${dateStr}  ${durLabel}`.padEnd(26).slice(0, 26);
              raw += `${leftCol2}\n`;
            } else {
              const leftCol1 = timeRange.padEnd(35).slice(0, 35);
              const totCol1 = totalStr.padStart(12).slice(-12);
              raw += `${leftCol1} ${totCol1}\n`;

              const leftCol2 = `${dateStr}  ${durLabel}`.padEnd(35).slice(0, 35);
              raw += `${leftCol2}\n`;
            }
          } else {
            // K58 single column
            const leftCol1 = timeRange.padEnd(22).slice(0, 22);
            const totCol1 = totalStr.padStart(11);
            raw += `${leftCol1} ${totCol1}\n`;
            raw += `${dateStr}  ${durLabel}\n`;
            if (template.showHourlyUnitPrice) {
              raw += `   Đ.Giá: ${priceStr}\n`;
            }
          }
        }
        continue;
      }

      const lineName = line.timeElapsedSeconds
        ? `Tổng thời gian (${formatDuration(line.timeElapsedSeconds)})`
        : 'Tổng thời gian';
      const totalStr = formatVnd(line.totalPrice);
      const priceStr = formatVnd(line.unitPrice) + (template.showHourlyUnitDuration ? '/1h' : '');

      if (profile.layoutMode === 'MULTI_COLUMN') {
        if (template.showHourlyUnitPrice) {
          const nameCol = lineName.padEnd(26).slice(0, 26);
          const priceCol = priceStr.padStart(9).slice(-9);
          const totCol = totalStr.padStart(11).slice(-11);
          raw += `${nameCol} ${priceCol} ${totCol}\n`;
        } else {
          const nameCol = lineName.padEnd(35).slice(0, 35);
          const totCol = totalStr.padStart(12).slice(-12);
          raw += `${nameCol} ${totCol}\n`;
        }
      } else {
        const nameCol = lineName.padEnd(22).slice(0, 22);
        const totCol = totalStr.padStart(11);
        raw += `${nameCol} ${totCol}\n`;
        if (template.showHourlyUnitPrice) {
          raw += `   Đ.Giá: ${priceStr}\n`;
        }
      }

      if (template.showHourlyDetail && line.timeStartedAtMs) {
        const startStr = formatDateTime(line.timeStartedAtMs, template.showHourlyTimeWithSeconds);
        const endStr = line.timeEndedAtMs
          ? formatDateTime(line.timeEndedAtMs, template.showHourlyTimeWithSeconds)
          : 'Hiện tại';
        if (template.hourlyDetailMode === 'FULL_TIMELOG') {
          raw += `   ${startStr} - ${endStr}\n`;
          raw += `   = ${formatDuration(line.timeElapsedSeconds || 0)}\n`;
        } else {
          raw += `   = ${formatDuration(line.timeElapsedSeconds || 0)}\n`;
        }
      }
    }
    raw += divider + '\n';
  }

  // 5. Section: Products / Goods (Mặt hàng)
  if (productLines.length > 0) {
    if (profile.layoutMode === 'MULTI_COLUMN') {
      if (template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN') {
        raw += 'Mặt hàng                SL    Đơn giá     T.Tiền\n';
      } else {
        raw += 'Mặt hàng                    SL/TL         T.Tiền\n';
      }
      raw += divider + '\n';
    } else {
      raw += 'Mặt hàng           SL       T.Tiền\n';
      raw += divider + '\n';
    }

    let itemIdx = 1;
    for (const line of productLines) {
      if (template.hideZeroPriceItems && line.totalPrice === 0) continue;

      const itemPrefix = template.showItemIndex ? `${itemIdx}. ` : '';
      itemIdx++;

      const lineName = `${itemPrefix}${formatReceiptLineName(line, template.showItemPriceName)}`;
      const qtyStr = String(line.quantity);
      const totalStr = formatVnd(line.totalPrice);
      const priceStr = formatVnd(line.unitPrice);

      if (profile.layoutMode === 'MULTI_COLUMN') {
        if (template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN') {
          const nameCol = lineName.padEnd(22).slice(0, 22);
          const qtyCol = qtyStr.padStart(4).slice(-4);
          const priceCol = priceStr.padStart(9).slice(-9);
          const totCol = totalStr.padStart(10).slice(-10);
          raw += `${nameCol} ${qtyCol} ${priceCol} ${totCol}\n`;
        } else {
          const nameCol = lineName.padEnd(28).slice(0, 28);
          const qtyCol = qtyStr.padStart(6);
          const totCol = totalStr.padStart(12);
          raw += `${nameCol} ${qtyCol} ${totCol}\n`;
          if (template.showItemUnitPrice) {
            raw += `   Đơn giá: ${priceStr}\n`;
          }
        }
      } else {
        // K58 Compact Stack
        const nameCol = lineName.padEnd(19).slice(0, 19);
        const qtyCol = qtyStr.padStart(4);
        const totCol = totalStr.padStart(10);
        raw += `${nameCol} ${qtyCol} ${totCol}\n`;
        if (template.showItemUnitPrice) {
          raw += `   * Đ.Giá: ${priceStr}\n`;
        }
      }

      if (template.showItemNote && line.note) {
        raw += `   * G/chú: ${line.note}\n`;
      }
      if (template.showItemDiscounts && (line.discountAmount ?? 0) > 0) {
        if (line.adjustmentSource === 'PROMOTION_GIFT') {
          raw += `   * Quà tặng khuyến mãi: -${formatVnd(line.discountAmount ?? 0)}đ\n`;
          raw += `   * Chương trình: ${line.promotionName || 'Khuyến mãi tặng món'}\n`;
        } else {
          raw += `   * Giảm thủ công: -${formatVnd(line.discountAmount ?? 0)}đ\n`;
          raw += `   * Lý do: ${line.discountReason || 'Chưa có lý do'}\n`;
        }
      }
    }
    raw += divider + '\n';
  }

  // 5. Summary & Totals
  if (timeLines.length > 0) {
    const label = `Tiền giờ:`;
    const value = `${formatVnd(timeTotal)}đ`;
    raw += `${label}${' '.repeat(Math.max(1, chars - label.length - value.length))}${value}\n`;
  }
  if (productLines.length > 0) {
    const label = `Tiền hàng (${productLines.length}):`;
    const value = `${formatVnd(goodsTotal)}đ`;
    raw += `${label}${' '.repeat(Math.max(1, chars - label.length - value.length))}${value}\n`;
  }
  if (
    template.combineGoodsAndServiceTotal &&
    timeLines.length > 0 &&
    productLines.length > 0 &&
    (data.receiptType !== 'PAYMENT' || data.discountTotal > 0)
  ) {
    const label = 'Tổng hàng & dịch vụ:';
    const value = `${formatVnd(timeTotal + goodsTotal)}đ`;
    raw += `${label}${' '.repeat(Math.max(1, chars - label.length - value.length))}${value}\n`;
  }
  const promotionDiscount = data.promotionDiscount ?? 0;
  if (template.showProvisionalTotal && promotionDiscount > 0) {
    const subLabel = 'Tổng tạm tính:';
    const subVal = formatVnd(timeTotal + goodsTotal) + 'đ';
    const padLen = chars - subLabel.length - subVal.length;
    raw += `${subLabel}${' '.repeat(Math.max(1, padLen))}${subVal}\n`;
  }

  if (template.showPromotionsList && promotionDiscount > 0) {
    const promotionLines =
      data.promotions && data.promotions.length > 0
        ? data.promotions
        : data.promotion
          ? [data.promotion]
          : [];
    if (promotionLines.length === 0)
      promotionLines.push({
        name: 'Khuyến mại',
        type: '',
        value: null,
        discountAmountVnd: promotionDiscount,
      });
    for (const promotion of promotionLines) {
      if (promotion.type === 'FLAT_PRICE' && (promotion.flatPriceItems?.length ?? 0) > 0) {
        raw += `KM: ${promotion.name} · Đồng giá ${formatVnd(promotion.value ?? 0)}đ\n`;
        for (const item of promotion.flatPriceItems ?? []) {
          const variant = item.variantName ? ` · ${item.variantName}` : '';
          const quantity = item.quantityMilli / 1000;
          raw += `   - ${item.productName}${variant} · SL: ${quantity}\n`;
        }
        raw += `   Giảm KM: -${formatVnd(promotion.discountAmountVnd)}đ\n`;
        continue;
      }
      const discLabel = `KM: ${promotion.name}:`;
      const discVal = '-' + formatVnd(promotion.discountAmountVnd) + 'đ';
      const padLen = chars - discLabel.length - discVal.length;
      raw += `${discLabel}${' '.repeat(Math.max(1, padLen))}${discVal}\n`;
    }
  }

  const grandLabel =
    data.receiptType === 'PROVISIONAL'
      ? 'TỔNG TẠM TÍNH:'
      : data.receiptType === 'DEBT_PAYMENT'
        ? 'SỐ TIỀN THU:'
        : 'TỔNG CỘNG:';
  const grandVal = formatVnd(data.total) + 'đ';
  const grandPad = chars - grandLabel.length - grandVal.length;
  raw += escBoldOn + `${grandLabel}${' '.repeat(Math.max(1, grandPad))}${grandVal}\n` + escBoldOff;

  if (data.receiptType === 'PAYMENT' && template.showPaymentMethod) {
    const allocations = data.paymentAllocations ?? [];
    const needsAllocationBreakdown =
      allocations.length > 1 || allocations.some((allocation) => allocation.method === 'DEBT');
    if (needsAllocationBreakdown) {
      for (const allocation of allocations) {
        const label =
          allocation.method === 'CASH'
            ? 'Tiền mặt đã thu'
            : allocation.method === 'DEBT'
              ? 'Ghi công nợ'
              : 'CK đã thu';
        raw += `${label.padEnd(20, ' ')}: ${formatVnd(allocation.amountVnd)}đ\n`;
      }
    } else if (allocations.length === 0 && (data.debtAmountVnd ?? 0) > 0) {
      if ((data.paidAmountVnd ?? 0) > 0)
        raw += `Đã thu             : ${formatVnd(data.paidAmountVnd!)}đ\n`;
      raw += `Ghi công nợ         : ${formatVnd(data.debtAmountVnd!)}đ\n`;
    }
  }
  if (data.receiptType === 'DEBT_PAYMENT') {
    raw += divider + '\n';
    raw += `Dư nợ trước         : ${formatVnd(data.debtBeforeVnd ?? 0)}đ\n`;
    raw += `Số tiền vừa thu     : ${formatVnd(data.debtPaymentVnd ?? data.total)}đ\n`;
    raw += `Dư nợ còn lại       : ${formatVnd(data.debtAfterVnd ?? 0)}đ\n`;
    if (data.referenceCode) raw += `Mã tham chiếu       : ${data.referenceCode}\n`;
    if (template.showPaymentMethod) {
      raw += `Phương thức         : ${data.paymentMethod === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}\n`;
    }
  }

  // 6. Payment method & Cash details
  if (
    data.receiptType === 'PAYMENT' &&
    template.showPaymentMethod &&
    data.paymentMethod &&
    (data.paymentAllocations?.length ?? 0) <= 1 &&
    !data.paymentAllocations?.some((allocation) => allocation.method === 'DEBT')
  ) {
    raw += divider + '\n';
    const methodStr = data.paymentMethod === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản (VietQR)';
    raw += `Hình thức thanh toán: ${methodStr}\n`;
    if (data.paymentMethod === 'CASH' && template.showCashDetails) {
      if (data.cashReceived !== null && data.cashReceived !== undefined) {
        raw += `Tiền khách đưa      : ${formatVnd(data.cashReceived)}đ\n`;
      }
      if (data.cashChange !== null && data.cashChange !== undefined) {
        raw += `Tiền thừa trả khách : ${formatVnd(data.cashChange)}đ\n`;
      }
    }
  }

  // 7. Wifi & Footer
  if (printSettings?.printWifiEnabled && (printSettings.wifiName || printSettings.wifiPassword)) {
    raw += divider + '\n';
    raw += escCenter;
    raw += `Wifi: ${printSettings.wifiName || 'Cửa hàng'}`;
    if (printSettings.wifiPassword) {
      raw += ` - Pass: ${printSettings.wifiPassword}`;
    }
    raw += '\n';
  }

  raw += escCenter;
  if (printSettings?.footerLine1) {
    if (printSettings.footerLine1Bold) raw += escBoldOn;
    raw += `${printSettings.footerLine1}\n`;
    if (printSettings.footerLine1Bold) raw += escBoldOff;
  }
  if (printSettings?.footerLine2) {
    if (printSettings.footerLine2Bold) raw += escBoldOn;
    raw += `${printSettings.footerLine2}\n`;
    if (printSettings.footerLine2Bold) raw += escBoldOff;
  }

  raw += '\n\n\n';

  if (printerConfig.openCashDrawer && data.receiptType === 'PAYMENT') {
    raw += escDrawer;
  }
  if (printerConfig.autoCut) {
    raw += escCut;
  }

  return {
    escPosData: raw,
    paperSize,
    autoCut: printerConfig.autoCut,
    openCashDrawer: printerConfig.openCashDrawer,
  };
}

export function buildPrintDataFromQuote(
  quote: any,
  receiptType: 'PROVISIONAL' | 'PAYMENT' = 'PROVISIONAL',
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | null | undefined,
  cashReceived?: number | null | undefined,
): PosReceiptPrintData {
  const lines: PosReceiptLineItem[] = [];

  // 1. Time session line if present
  if (quote.time) {
    lines.push({
      id: 'time-session',
      name: 'Tiền giờ',
      quantity: 1,
      unitPrice: quote.time.pricingConfig?.basePriceVnd ?? quote.time.amountAfterRoundingVnd,
      totalPrice: quote.time.amountAfterRoundingVnd,
      isTime: true,
      timeStartedAtMs: quote.time.startedAtMs,
      timeEndedAtMs: quote.time.endedAtMs ?? null,
      timeElapsedSeconds: quote.time.elapsedSeconds,
      timeSegments: reconcileReceiptTimeSegmentAmounts(
        compactReceiptTimeSegments(
          quote.time.segments?.map((s: any): PosReceiptTimeSegment => ({
            name: s.name,
            type: s.type,
            startedAtMs: s.startedAtMs ?? quote.time!.startedAtMs,
            endedAtMs: s.endedAtMs ?? quote.time!.endedAtMs ?? null,
            elapsedSeconds: s.elapsedSeconds,
            priceVnd:
              s.priceVnd ??
              quote.time!.pricingConfig?.basePriceVnd ??
              quote.time!.amountAfterRoundingVnd,
            amount: s.amountAfterRoundingVnd ?? s.amountBeforeRoundingVnd ?? s.amount ?? 0,
          })),
        ),
        quote.time.amountAfterRoundingVnd,
      ),
      tableSegments: quote.time.tableSegments?.map((t: any) => ({
        tableName: t.tableName,
        startedAtMs: t.startedAtMs,
        endedAtMs: t.endedAtMs ?? null,
        elapsedSeconds: t.elapsedSeconds,
        amount: t.amountAfterRoundingVnd ?? t.amountBeforeRoundingVnd ?? 0,
        hourlyPrice: t.pricingConfig?.basePriceVnd ?? t.hourlyPrice,
      })),
    });
  } else if (quote.timeSegments && quote.timeSegments.length > 0) {
    const totalTimeAmt =
      quote.totals?.timeAmountVnd ??
      quote.timeSummary?.totalAmountAfterRoundingVnd ??
      quote.timeSegments.reduce(
        (sum: number, s: any) => sum + (s.amountAfterRoundingVnd ?? s.amount ?? 0),
        0,
      );
    const totalElapsed =
      quote.timeSummary?.totalElapsedSeconds ??
      quote.timeSegments.reduce((sum: number, s: any) => sum + (s.elapsedSeconds ?? 0), 0);

    lines.push({
      id: 'time-session',
      name: 'Tiền giờ',
      quantity: 1,
      unitPrice: quote.timeSegments[0]?.unitPriceSnapshot ?? totalTimeAmt,
      totalPrice: totalTimeAmt,
      isTime: true,
      timeStartedAtMs: quote.timeSegments[0]?.startedAt,
      timeEndedAtMs: quote.order?.status === 'OPEN' ? null : quote.order?.closedAt,
      timeElapsedSeconds: totalElapsed,
      timeSegments: reconcileReceiptTimeSegmentAmounts(
        compactReceiptTimeSegments(
          quote.timeSegments.map((s: any): PosReceiptTimeSegment => ({
            name: s.rateNameSnapshot || s.name || 'Giá tính giờ',
            type: s.type || 'BASE',
            startedAtMs: s.startedAt,
            endedAtMs: s.endedAt ?? null,
            elapsedSeconds: s.elapsedSeconds,
            priceVnd: s.unitPriceSnapshot ?? s.priceVnd ?? totalTimeAmt,
            amount: s.amountAfterRoundingVnd ?? s.amountBeforeRoundingVnd ?? s.amount ?? 0,
          })),
        ),
        totalTimeAmt,
      ),
      tableSegments: quote.timeSegments.map((s: any) => ({
        tableName: s.tableName,
        startedAtMs: s.startedAt,
        endedAtMs: s.endedAt ?? null,
        elapsedSeconds: s.elapsedSeconds,
        amount: s.amountAfterRoundingVnd ?? s.amount ?? 0,
        hourlyPrice: s.unitPriceSnapshot,
      })),
    });
  }

  // 2. Regular items
  const rawItems = quote.items || [];
  for (const item of rawItems) {
    const isItemTime = item.productType === 'TIME';
    if (isItemTime && lines.some((l) => l.isTime)) continue;

    lines.push({
      id: item.id,
      name: item.productNameSnapshot || item.productName || item.description || '',
      priceName: item.variantNameSnapshot ?? item.variantName ?? null,
      priceVariantCount: item.priceVariantCount ?? item.variantCount ?? 0,
      quantity:
        typeof item.quantityMilli === 'number'
          ? item.quantityMilli / 1000
          : typeof item.quantity === 'number'
            ? item.quantity
            : 1,
      unitPrice: item.unitPriceSnapshot ?? item.unitPriceVnd ?? item.unitPrice ?? 0,
      totalPrice: item.netLineTotalVnd ?? item.lineTotal ?? 0,
      unitName: item.unitNameSnapshot ?? item.unitName ?? null,
      note: item.note ?? null,
      discountAmount: item.discountAmountVnd ?? item.discountAmount ?? 0,
      discountReason: item.discountReason ?? null,
      adjustmentSource:
        item.promotionGift || item.adjustmentSource === 'PROMOTION_GIFT'
          ? 'PROMOTION_GIFT'
          : 'MANUAL',
      promotionName: item.promotionGift?.promotionName ?? item.promotionName ?? null,
      isTime: isItemTime,
      timeStartedAtMs: item.timeStartedAtMs,
      timeEndedAtMs: item.timeEndedAtMs,
    });
  }

  const subtotal =
    quote.subtotalVnd ??
    quote.totals?.subtotalVnd ??
    quote.subtotal ??
    quote.invoice?.subtotalVnd ??
    0;
  const discountTotal =
    quote.discountTotalVnd ??
    quote.totals?.totalDiscountVnd ??
    quote.totals?.discountTotalVnd ??
    quote.discountTotal ??
    quote.invoice?.discountTotalVnd ??
    0;
  const total =
    quote.totalVnd ?? quote.totals?.totalVnd ?? quote.total ?? quote.invoice?.totalVnd ?? 0;

  const resolvedPaymentMethod =
    paymentMethod ??
    quote.paymentMethod ??
    quote.payments?.[0]?.method ??
    quote.paymentAllocations?.[0]?.method ??
    null;
  const resolvedCashReceived =
    cashReceived ??
    quote.cashReceived ??
    quote.payments?.[0]?.cashReceived ??
    quote.paymentAllocations?.[0]?.tenderedVnd ??
    null;
  const cashChange =
    resolvedPaymentMethod === 'CASH' &&
    resolvedCashReceived !== null &&
    resolvedCashReceived !== undefined
      ? Math.max(0, resolvedCashReceived - total)
      : (quote.cashChange ?? quote.totals?.changeAmountVnd ?? null);

  const orderObj = quote.order || {};
  const customerObj = quote.customer || {};

  return {
    receiptType,
    orderCode:
      orderObj.displayCode ||
      quote.invoice?.displayCode ||
      (orderObj.id ? `D-${orderObj.id.slice(0, 8).toUpperCase()}` : '—'),
    invoiceCode: quote.invoice?.displayCode || orderObj.displayCode || null,
    orderType: orderObj.orderType || 'DINE_IN',
    tableName: orderObj.tableName ?? null,
    areaName: orderObj.areaName ?? null,
    cashierName:
      quote.invoice?.issuedByName ??
      orderObj.cashierName ??
      orderObj.openedByName ??
      quote.cashierName ??
      null,
    customerName: customerObj.name ?? orderObj.customerName ?? quote.customerName ?? null,
    guestPhone:
      customerObj.phone ??
      orderObj.guestPhone ??
      orderObj.customerPhone ??
      quote.guestPhone ??
      null,
    guestAddress: orderObj.guestAddress ?? quote.guestAddress ?? null,
    note: orderObj.note ?? quote.note ?? null,
    checkInTimeMs: quote.time?.startedAtMs || orderObj.openedAt || quote.checkInTimeMs || null,
    issuedAtMs: quote.invoice?.issuedAt || Date.now(),
    subtotal,
    discountTotal,
    promotionDiscount:
      quote.promotionDiscountVnd ??
      quote.totals?.orderDiscountAmountVnd ??
      quote.promotion?.discountAmountVnd ??
      0,
    promotion: quote.promotion ?? quote.promotions?.[0] ?? null,
    promotions: quote.promotions ?? (quote.promotion ? [quote.promotion] : []),
    total,
    paymentMethod: resolvedPaymentMethod,
    cashReceived: resolvedCashReceived,
    cashChange,
    paymentAllocations:
      quote.paymentAllocations?.map((a: any) => ({
        method: a.method,
        amountVnd: a.amountVnd ?? a.amount ?? 0,
      })) ??
      quote.allocations?.map((a: any) => ({
        method: a.method,
        amountVnd: a.amountVnd ?? a.amount ?? 0,
      })),
    paidAmountVnd: quote.totals?.paidAmountVnd ?? quote.paidAmountVnd,
    debtAmountVnd: quote.totals?.debtAmountVnd ?? quote.debtAmountVnd,
    lines,
  };
}

export function buildPrintDataFromInvoice(rawInvoiceData: any): PosReceiptPrintData {
  if (!rawInvoiceData) {
    throw new Error('Dữ liệu hóa đơn không hợp lệ.');
  }

  // Case 1: OrderDetailData structure ({ order, customer, items, timeSegments, payments, paymentAllocations, invoice, promotions, totals })
  if (rawInvoiceData.order && rawInvoiceData.invoice) {
    const printData = buildPrintDataFromQuote(rawInvoiceData, 'PAYMENT');
    printData.orderCode = rawInvoiceData.invoice.displayCode || printData.orderCode;
    printData.invoiceCode = rawInvoiceData.invoice.displayCode || printData.invoiceCode;
    printData.cashierName =
      rawInvoiceData.invoice.issuedByName ||
      rawInvoiceData.invoice.cashierName ||
      printData.cashierName;
    printData.issuedAtMs = rawInvoiceData.invoice.issuedAt || printData.issuedAtMs;
    printData.subtotal =
      rawInvoiceData.invoice.subtotalVnd ?? rawInvoiceData.invoice.subtotal ?? printData.subtotal;
    printData.discountTotal =
      rawInvoiceData.invoice.discountTotalVnd ??
      rawInvoiceData.invoice.discountTotal ??
      printData.discountTotal;
    printData.total =
      rawInvoiceData.invoice.totalVnd ?? rawInvoiceData.invoice.total ?? printData.total;

    const successfulPayment = rawInvoiceData.payments?.find((p: any) => p.status === 'SUCCEEDED');
    if (successfulPayment) {
      printData.paymentMethod = successfulPayment.method;
      printData.cashReceived = successfulPayment.cashReceived ?? printData.cashReceived;
      printData.cashChange = successfulPayment.cashChange ?? printData.cashChange;
    }
    if (rawInvoiceData.paymentAllocations?.length) {
      printData.paymentAllocations = rawInvoiceData.paymentAllocations.map((a: any) => ({
        method: a.method,
        amountVnd: a.amountVnd ?? a.amount ?? 0,
      }));
      printData.paidAmountVnd = rawInvoiceData.totals?.paidAmountVnd;
      printData.debtAmountVnd = rawInvoiceData.totals?.debtAmountVnd;
    }
    return printData;
  }

  // Case 2: InvoiceDetailData structure ({ invoice: {...}, lines: [...], payment: {...}, allocations: [...] })
  const invoice = rawInvoiceData.invoice || rawInvoiceData;
  const lines: PosReceiptLineItem[] = [];
  let invoiceSnapshot: any = {};
  try {
    invoiceSnapshot = invoice.snapshotJson ? JSON.parse(invoice.snapshotJson) : {};
  } catch {
    // ignore
  }

  const rawLines = rawInvoiceData.lines || invoice.lines || [];
  for (const line of rawLines) {
    let snapshot: any = {};
    try {
      snapshot = line.snapshotJson ? JSON.parse(line.snapshotJson) : {};
    } catch {
      // ignore
    }

    const isTime = line.lineType === 'TIME' || snapshot.productType === 'TIME';
    const orderItemSnapshot = invoiceSnapshot.items?.find(
      (item: any) =>
        item.productId === snapshot.productId &&
        (item.variantId ?? null) === (snapshot.variantId ?? null) &&
        Boolean(item.promotionGift) === Boolean(snapshot.promotionGift),
    );
    const promotionGift = snapshot.promotionGift ?? orderItemSnapshot?.promotionGift;

    lines.push({
      id: line.id,
      name: line.description || line.productName || snapshot.productName || '',
      priceName:
        line.variantName ??
        snapshot.variantNameSnapshot ??
        snapshot.variantName ??
        orderItemSnapshot?.variantNameSnapshot ??
        orderItemSnapshot?.variantName ??
        null,
      priceVariantCount:
        snapshot.priceVariantCount ??
        snapshot.variantCount ??
        orderItemSnapshot?.priceVariantCount ??
        orderItemSnapshot?.variantCount ??
        line.priceVariantCount ??
        0,
      quantity:
        typeof line.quantityMilli === 'number'
          ? line.quantityMilli / 1000
          : typeof line.quantity === 'number'
            ? line.quantity
            : 1,
      unitPrice: line.unitPrice ?? snapshot.unitPrice ?? 0,
      totalPrice: line.lineTotal ?? line.totalPrice ?? 0,
      unitName: snapshot.unitName ?? null,
      note: snapshot.note ?? line.note ?? null,
      discountAmount: orderItemSnapshot?.discountAmountVnd ?? line.discountAmount ?? 0,
      discountReason: orderItemSnapshot?.discountReason ?? line.discountReason ?? null,
      adjustmentSource: promotionGift ? 'PROMOTION_GIFT' : 'MANUAL',
      promotionName: promotionGift?.promotionName ?? null,
      isTime,
      timeStartedAtMs: snapshot.startedAtMs,
      timeEndedAtMs: snapshot.endedAtMs ?? null,
      timeElapsedSeconds: snapshot.elapsedSeconds,
      timeSegments: reconcileReceiptTimeSegmentAmounts(
        compactReceiptTimeSegments(
          (snapshot.segments ?? invoiceSnapshot.time?.segments)?.map((s: any) => ({
            name: s.name,
            type: s.type,
            startedAtMs: s.startedAtMs,
            endedAtMs: s.endedAtMs,
            elapsedSeconds: s.elapsedSeconds,
            priceVnd: s.priceVnd ?? line.unitPrice,
            amount:
              s.amountAfterRoundingVnd ?? s.amountBeforeRoundingVnd ?? s.amount ?? line.lineTotal,
          })),
        ),
        line.lineTotal,
      ),
      tableSegments: snapshot.tableSegments?.map((t: any) => ({
        tableName: t.tableName,
        startedAtMs: t.startedAtMs,
        endedAtMs: t.endedAtMs ?? null,
        elapsedSeconds: t.elapsedSeconds,
        amount: t.amountAfterRoundingVnd ?? t.amount ?? 0,
        hourlyPrice: t.pricingConfig?.basePriceVnd,
      })),
    });
  }

  const payment = rawInvoiceData.payment || invoice.payment || {};
  const allocations = rawInvoiceData.allocations || rawInvoiceData.paymentAllocations || [];

  return {
    receiptType: 'PAYMENT',
    orderCode: invoice.displayCode || invoice.id || '—',
    invoiceCode: invoice.displayCode || null,
    orderType: invoice.orderType || 'DINE_IN',
    tableName: invoice.tableName ?? invoiceSnapshot.order?.tableName ?? null,
    areaName: invoiceSnapshot.order?.areaName ?? null,
    cashierName:
      invoice.issuedByName ?? invoice.cashierName ?? invoiceSnapshot.order?.openedByName ?? null,
    customerName: invoiceSnapshot.order?.customerName ?? invoice.customerName ?? null,
    guestPhone:
      invoice.guestPhone ??
      invoiceSnapshot.order?.customerPhone ??
      invoiceSnapshot.order?.guestPhone ??
      null,
    guestAddress: invoice.guestAddress ?? invoiceSnapshot.order?.guestAddress ?? null,
    note: invoice.note ?? invoiceSnapshot.order?.note ?? null,
    checkInTimeMs: invoiceSnapshot.order?.openedAt ?? invoice.checkInTimeMs ?? null,
    issuedAtMs: invoice.issuedAt || Date.now(),
    subtotal: invoice.subtotalVnd ?? invoice.subtotal ?? 0,
    discountTotal: invoice.discountTotalVnd ?? invoice.discountTotal ?? 0,
    promotionDiscount:
      invoiceSnapshot.promotions?.reduce(
        (sum: number, promotion: any) => sum + (promotion.discountAmountVnd || 0),
        0,
      ) ??
      invoiceSnapshot.promotion?.discountAmountVnd ??
      0,
    promotion: invoiceSnapshot.promotion ?? null,
    promotions:
      invoiceSnapshot.promotions ?? (invoiceSnapshot.promotion ? [invoiceSnapshot.promotion] : []),
    total: invoice.totalVnd ?? invoice.total ?? 0,
    paymentMethod: payment.method ?? allocations[0]?.method ?? 'CASH',
    cashReceived: payment.cashReceived ?? null,
    cashChange: payment.cashChange ?? null,
    paymentAllocations: allocations.length
      ? allocations.map((a: any) => ({
          method: a.method,
          amountVnd: a.amountVnd ?? a.amount ?? 0,
        }))
      : undefined,
    paidAmountVnd: allocations.length
      ? allocations
          .filter((a: any) => a.method !== 'DEBT')
          .reduce((sum: number, a: any) => sum + (a.amountVnd ?? a.amount ?? 0), 0)
      : (invoice.totalVnd ?? invoice.total),
    debtAmountVnd: allocations.length
      ? allocations
          .filter((a: any) => a.method === 'DEBT')
          .reduce((sum: number, a: any) => sum + (a.amountVnd ?? a.amount ?? 0), 0)
      : 0,
    lines,
  };
}

export function buildPrintDataFromDebtPayment(rawPaymentData: unknown): PosReceiptPrintData {
  if (!rawPaymentData || typeof rawPaymentData !== 'object') {
    throw new Error('Dữ liệu phiếu thu công nợ không hợp lệ.');
  }
  const payment = rawPaymentData as {
    id?: string;
    referenceCode?: string | null;
    amountVnd?: number;
    paymentMethod?: 'CASH' | 'BANK_TRANSFER';
    createdAt?: number;
    customerName?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
    debtBeforeVnd?: number;
    debtAfterVnd?: number;
  };
  if (!payment.id || !payment.amountVnd || payment.amountVnd <= 0) {
    throw new Error('Dữ liệu phiếu thu công nợ không đầy đủ.');
  }
  const referenceCode = payment.referenceCode || payment.id;
  return {
    receiptType: 'DEBT_PAYMENT',
    orderCode: referenceCode,
    invoiceCode: referenceCode,
    orderType: 'TAKEAWAY',
    customerName: payment.customerName ?? null,
    guestPhone: payment.customerPhone ?? null,
    guestAddress: payment.customerAddress ?? null,
    issuedAtMs: payment.createdAt ?? Date.now(),
    subtotal: payment.debtBeforeVnd ?? payment.amountVnd,
    discountTotal: 0,
    total: payment.amountVnd,
    paymentMethod: payment.paymentMethod ?? null,
    debtBeforeVnd: payment.debtBeforeVnd ?? payment.amountVnd,
    debtPaymentVnd: payment.amountVnd,
    debtAfterVnd: payment.debtAfterVnd ?? 0,
    referenceCode,
    lines: [],
  };
}
