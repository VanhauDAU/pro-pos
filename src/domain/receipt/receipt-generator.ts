import {
  type PaperSize,
  type StorePrintSettings,
  getReceiptPrintProfile,
  parsePrintTemplateConfigs,
  parsePrinterDeviceConfig,
} from '@contracts/store';

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

export interface PosReceiptLineItem {
  id: string;
  name: string;
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
  const { data, printSettings, storeInfo } = options;
  const templateConfigs = parsePrintTemplateConfigs(printSettings?.templateConfigJson);
  const template =
    data.receiptType === 'PROVISIONAL' ? templateConfigs.PROVISIONAL : templateConfigs.PAYMENT;

  const printerConfig = parsePrinterDeviceConfig(printSettings?.printersJson);
  const paperSize: PaperSize = printSettings?.paperSize || printerConfig.paperSize || 'K80';
  const profile = getReceiptPrintProfile(paperSize, printerConfig.printableDots);
  const chars = profile.charsPerLineFontA;
  const divider = '-'.repeat(chars);

  const escInit = '\x1B\x40';
  const escCenter = '\x1B\x61\x01';
  const escLeft = '\x1B\x61\x00';
  const escBoldOn = '\x1B\x45\x01';
  const escBoldOff = '\x1B\x45\x00';
  const escCut = '\x1D\x56\x41\x00';
  const escDrawer = '\x1B\x70\x00\x19\xFA';

  let raw = escInit;

  // 1. Header (Store Name, Address, Phone)
  const storeName = storeInfo?.storeName || 'PRO POS';
  const storeAddress = printSettings?.customAddressEnabled
    ? printSettings.customAddress
    : storeInfo?.address;
  const storePhone = storeInfo?.phone;

  raw += escCenter + escBoldOn + storeName.toUpperCase() + '\n' + escBoldOff;
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
  if (data.receiptType === 'PROVISIONAL') {
    raw += escBoldOn + '*** CHƯA THANH TOÁN ***\n' + escBoldOff;
  }
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
  if (template.showCustomerName && data.customerName) {
    raw += `Khách hàng   : ${data.customerName}\n`;
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
        ? 'Thông tin giờ                            Đ.Giá     T.Tiền\n'
        : 'Thông tin giờ                                      T.Tiền\n';
      raw += divider + '\n';
    } else {
      raw += 'Thông tin giờ              T.Tiền\n';
      raw += divider + '\n';
    }

    let timeIdx = 1;
    for (const line of timeLines) {
      const itemPrefix = template.showItemIndex ? `${timeIdx}. ` : '';
      timeIdx++;

      if (
        line.tableSegments &&
        line.tableSegments.length > 1 &&
        (!line.timeSegments || line.timeSegments.length === 0)
      ) {
        raw += `${itemPrefix}Tiền giờ (Chuyển bàn)\n`;
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
        raw += `${itemPrefix}${line.name}\n`;
        for (const seg of line.timeSegments) {
          const startStr = formatTimeOnly(seg.startedAtMs, template.showHourlyTimeWithSeconds);
          const endStr = seg.endedAtMs
            ? formatTimeOnly(seg.endedAtMs, template.showHourlyTimeWithSeconds)
            : 'Hiện tại';
          const timeRange = `${startStr} - ${endStr}`;
          const dateStr = formatDateOnly(seg.startedAtMs);
          const durLabel = formatSegmentDurationLabel(seg);
          const priceStr = formatVnd(seg.priceVnd);
          const unitStr = template.showHourlyUnitDuration ? '/1h' : '';
          const totalStr = formatVnd(seg.amount);

          if (profile.layoutMode === 'MULTI_COLUMN') {
            raw += `${timeRange}\n`;
            if (template.showHourlyUnitPrice) {
              const leftCol1 = dateStr.padEnd(28).slice(0, 28);
              const priceCol1 = priceStr.padStart(10);
              const totCol1 = totalStr.padStart(10);
              raw += `${leftCol1} ${priceCol1} ${totCol1}\n`;

              const leftCol2 = durLabel.padEnd(28).slice(0, 28);
              const priceCol2 = unitStr.padStart(10);
              const totCol2 = ''.padStart(10);
              raw += `${leftCol2} ${priceCol2} ${totCol2}\n`;
            } else {
              const leftCol1 = dateStr.padEnd(36).slice(0, 36);
              const totCol1 = totalStr.padStart(12);
              raw += `${leftCol1} ${totCol1}\n`;

              const leftCol2 = durLabel.padEnd(36).slice(0, 36);
              raw += `${leftCol2}\n`;
            }
            raw += '\n';
          } else {
            // K58 single column
            raw += `${timeRange}\n`;
            const leftCol1 = dateStr.padEnd(22).slice(0, 22);
            const totCol1 = totalStr.padStart(11);
            raw += `${leftCol1} ${totCol1}\n`;
            raw += `${durLabel}\n`;
            if (template.showHourlyUnitPrice) {
              raw += `   Đ.Giá: ${priceStr}${unitStr}\n`;
            }
            raw += '\n';
          }
        }
        continue;
      }

      const durStr = line.timeElapsedSeconds ? ` (${formatDuration(line.timeElapsedSeconds)})` : '';
      const lineName = `${itemPrefix}${line.name}${durStr}`;
      const totalStr = formatVnd(line.totalPrice);
      const priceStr = formatVnd(line.unitPrice) + (template.showHourlyUnitDuration ? '/1h' : '');

      if (profile.layoutMode === 'MULTI_COLUMN') {
        if (template.showHourlyUnitPrice) {
          const nameCol = lineName.padEnd(28).slice(0, 28);
          const priceCol = priceStr.padStart(10);
          const totCol = totalStr.padStart(10);
          raw += `${nameCol} ${priceCol} ${totCol}\n`;
        } else {
          const nameCol = lineName.padEnd(36).slice(0, 36);
          const totCol = totalStr.padStart(12);
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

      const lineName = `${itemPrefix}${line.name}${template.showItemPriceName ? ' (Giá chuẩn)' : ''}`;
      const qtyStr = String(line.quantity);
      const totalStr = formatVnd(line.totalPrice);
      const priceStr = formatVnd(line.unitPrice);

      if (profile.layoutMode === 'MULTI_COLUMN') {
        if (template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN') {
          const nameCol = lineName.padEnd(23).slice(0, 23);
          const qtyCol = qtyStr.padStart(5);
          const priceCol = priceStr.padStart(9);
          const totCol = totalStr.padStart(10);
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
    const label = `Tiền giờ (${timeLines.length}):`;
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
  quote: {
    order: {
      id: string;
      displayCode: string | null;
      orderType: 'DINE_IN' | 'TAKEAWAY';
      tableName: string | null;
      areaName?: string | null | undefined;
      cashierName?: string | null | undefined;
      openedByName?: string | null | undefined;
      customerName?: string | null | undefined;
      customerPhone?: string | null | undefined;
      guestPhone?: string | null | undefined;
      guestAddress?: string | null | undefined;
      note?: string | null | undefined;
      openedAt: number;
    };
    items: Array<{
      id: string;
      productName: string;
      quantityMilli: number;
      unitPriceVnd: number;
      netLineTotalVnd: number;
      discountAmountVnd?: number | undefined;
      discountReason?: string | null | undefined;
      promotionGift?: { promotionName: string } | undefined;
      unitName?: string | null | undefined;
      note?: string | null | undefined;
    }>;
    time?:
      | {
          startedAtMs: number;
          endedAtMs: number | null | undefined;
          elapsedSeconds: number;
          amountAfterRoundingVnd: number;
          pricingConfig?: { basePriceVnd: number } | undefined;
          segments?:
            | Array<{
                name: string;
                type?: 'BASE' | 'FIRST_PERIOD' | 'SPECIAL' | string | undefined;
                startedAtMs?: number | undefined;
                endedAtMs?: number | null | undefined;
                elapsedSeconds: number;
                priceVnd?: number | undefined;
                amountBeforeRoundingVnd?: number | undefined;
                amountAfterRoundingVnd?: number | undefined;
              }>
            | undefined;
          tableSegments?:
            | Array<{
                tableName: string;
                startedAtMs: number;
                endedAtMs: number | null | undefined;
                elapsedSeconds: number;
                amountBeforeRoundingVnd?: number | undefined;
                amountAfterRoundingVnd?: number | undefined;
                pricingConfig?: { basePriceVnd: number } | undefined;
              }>
            | undefined;
        }
      | null
      | undefined;
    subtotalVnd?: number | undefined;
    discountTotalVnd?: number | undefined;
    promotionDiscountVnd?: number | undefined;
    promotion?: PosReceiptPromotion | null | undefined;
    promotions?: PosReceiptPromotion[] | undefined;
    totalVnd?: number | undefined;
    totals?:
      | {
          subtotalVnd: number;
          discountTotalVnd: number;
          totalVnd: number;
        }
      | undefined;
  },
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
      timeSegments: compactReceiptTimeSegments(
        quote.time.segments?.map((s): PosReceiptTimeSegment => ({
          name: s.name,
          type: s.type,
          startedAtMs: s.startedAtMs ?? quote.time!.startedAtMs,
          endedAtMs: s.endedAtMs ?? quote.time!.endedAtMs ?? null,
          elapsedSeconds: s.elapsedSeconds,
          priceVnd:
            s.priceVnd ??
            quote.time!.pricingConfig?.basePriceVnd ??
            quote.time!.amountAfterRoundingVnd,
          amount: s.amountAfterRoundingVnd ?? s.amountBeforeRoundingVnd ?? 0,
        })),
      ),
      tableSegments: quote.time.tableSegments?.map((t) => ({
        tableName: t.tableName,
        startedAtMs: t.startedAtMs,
        endedAtMs: t.endedAtMs ?? null,
        elapsedSeconds: t.elapsedSeconds,
        amount: t.amountAfterRoundingVnd ?? t.amountBeforeRoundingVnd ?? 0,
        hourlyPrice: t.pricingConfig?.basePriceVnd,
      })),
    });
  }

  // 2. Regular items
  for (const item of quote.items) {
    lines.push({
      id: item.id,
      name: item.productName,
      quantity: item.quantityMilli / 1000,
      unitPrice: item.unitPriceVnd,
      totalPrice: item.netLineTotalVnd,
      unitName: item.unitName ?? null,
      note: item.note ?? null,
      discountAmount: item.discountAmountVnd ?? 0,
      discountReason: item.discountReason ?? null,
      adjustmentSource: item.promotionGift ? 'PROMOTION_GIFT' : 'MANUAL',
      promotionName: item.promotionGift?.promotionName ?? null,
    });
  }

  const subtotal = quote.subtotalVnd ?? quote.totals?.subtotalVnd ?? 0;
  const discountTotal = quote.discountTotalVnd ?? quote.totals?.discountTotalVnd ?? 0;
  const total = quote.totalVnd ?? quote.totals?.totalVnd ?? 0;

  const cashChange =
    paymentMethod === 'CASH' && cashReceived !== null && cashReceived !== undefined
      ? Math.max(0, cashReceived - total)
      : null;

  return {
    receiptType,
    orderCode:
      quote.order.displayCode ||
      (quote.order.id ? `D-${quote.order.id.slice(0, 8).toUpperCase()}` : '—'),
    invoiceCode: quote.order.displayCode || null,
    orderType: quote.order.orderType,
    tableName: quote.order.tableName,
    areaName: quote.order.areaName ?? null,
    cashierName: quote.order.cashierName ?? quote.order.openedByName ?? null,
    customerName: quote.order.customerName ?? null,
    guestPhone: quote.order.guestPhone ?? quote.order.customerPhone ?? null,
    guestAddress: quote.order.guestAddress ?? null,
    note: quote.order.note ?? null,
    checkInTimeMs: quote.time?.startedAtMs || quote.order.openedAt,
    issuedAtMs: Date.now(),
    subtotal,
    discountTotal,
    promotionDiscount: quote.promotionDiscountVnd ?? quote.promotion?.discountAmountVnd ?? 0,
    promotion: quote.promotion ?? null,
    promotions: quote.promotions ?? (quote.promotion ? [quote.promotion] : []),
    total,
    paymentMethod: paymentMethod ?? null,
    cashReceived: cashReceived ?? null,
    cashChange,
    lines,
  };
}

export function buildPrintDataFromInvoice(invoice: {
  invoice: {
    id: string;
    displayCode: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    tableName?: string | null | undefined;
    cashierName?: string | null | undefined;
    guestPhone?: string | null | undefined;
    guestAddress?: string | null | undefined;
    note?: string | null | undefined;
    snapshotJson?: string | null | undefined;
    issuedAt: number;
    subtotal: number;
    discountTotal: number;
    total: number;
  };
  payment: {
    method: 'CASH' | 'BANK_TRANSFER';
    cashReceived?: number | null | undefined;
    cashChange?: number | null | undefined;
  };
  lines: Array<{
    id: string;
    lineType: 'PRODUCT' | 'TIME';
    description: string;
    quantityMilli: number;
    unitPrice: number;
    lineTotal: number;
    snapshotJson: string;
  }>;
}): PosReceiptPrintData {
  const lines: PosReceiptLineItem[] = [];
  let invoiceSnapshot: {
    order?: {
      tableName?: string | null;
      areaName?: string | null;
      openedAt?: number;
      openedByName?: string | null;
      customerName?: string | null;
      customerPhone?: string | null;
      note?: string | null;
    };
    items?: Array<{
      productId: string;
      variantId?: string | null;
      discountAmountVnd?: number;
      discountReason?: string | null;
      promotionGift?: { promotionName: string };
    }>;
    time?: {
      startedAtMs?: number;
      endedAtMs?: number | null;
      elapsedSeconds?: number;
      amountBeforeRoundingVnd?: number;
      amountAfterRoundingVnd?: number;
      segments?: Array<{
        name: string;
        type?: 'BASE' | 'FIRST_PERIOD' | 'SPECIAL' | string | undefined;
        startedAtMs?: number | undefined;
        endedAtMs?: number | null | undefined;
        elapsedSeconds: number;
        priceVnd?: number | undefined;
        amountBeforeRoundingVnd?: number | undefined;
        amountAfterRoundingVnd?: number | undefined;
      }>;
    };
    promotion?: PosReceiptPromotion | null;
    promotions?: PosReceiptPromotion[];
  } = {};
  try {
    invoiceSnapshot = invoice.invoice.snapshotJson
      ? (JSON.parse(invoice.invoice.snapshotJson) as typeof invoiceSnapshot)
      : {};
  } catch {
    // Older invoices may not contain a parseable snapshot.
  }

  for (const line of invoice.lines) {
    let snapshot: {
      productId?: string;
      variantId?: string | null;
      productType?: 'QUANTITY' | 'WEIGHT' | 'TIME';
      unitName?: string | null;
      variantName?: string | null;
      note?: string | null;
      elapsedSeconds?: number;
      startedAtMs?: number;
      endedAtMs?: number | null;
      segments?: Array<{
        name: string;
        type?: 'BASE' | 'FIRST_PERIOD' | 'SPECIAL' | string | undefined;
        startedAtMs?: number | undefined;
        endedAtMs?: number | null | undefined;
        elapsedSeconds: number;
        priceVnd?: number | undefined;
        amountBeforeRoundingVnd?: number | undefined;
        amountAfterRoundingVnd?: number | undefined;
      }>;
      tableSegments?: Array<{
        tableName: string;
        startedAtMs: number;
        endedAtMs: number | null;
        elapsedSeconds: number;
        amountAfterRoundingVnd: number;
        pricingConfig?: { basePriceVnd: number };
      }>;
      promotionGift?: { promotionName: string };
    } = {};

    try {
      snapshot = JSON.parse(line.snapshotJson);
    } catch {
      // ignore
    }

    const isTime = line.lineType === 'TIME' || snapshot.productType === 'TIME';
    const orderItemSnapshot = invoiceSnapshot.items?.find(
      (item) =>
        item.productId === snapshot.productId &&
        (item.variantId ?? null) === (snapshot.variantId ?? null) &&
        Boolean(item.promotionGift) === Boolean(snapshot.promotionGift),
    );
    const promotionGift = snapshot.promotionGift ?? orderItemSnapshot?.promotionGift;

    lines.push({
      id: line.id,
      name: line.description,
      quantity: line.quantityMilli / 1000,
      unitPrice: line.unitPrice,
      totalPrice: line.lineTotal,
      unitName: snapshot.unitName ?? null,
      note: snapshot.note ?? null,
      discountAmount: orderItemSnapshot?.discountAmountVnd ?? 0,
      discountReason: orderItemSnapshot?.discountReason ?? null,
      adjustmentSource: promotionGift ? 'PROMOTION_GIFT' : 'MANUAL',
      promotionName: promotionGift?.promotionName ?? null,
      isTime,
      timeStartedAtMs: snapshot.startedAtMs,
      timeEndedAtMs: snapshot.endedAtMs ?? null,
      timeElapsedSeconds: snapshot.elapsedSeconds,
      timeSegments: compactReceiptTimeSegments(
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
      tableSegments: snapshot.tableSegments?.map((t) => ({
        tableName: t.tableName,
        startedAtMs: t.startedAtMs,
        endedAtMs: t.endedAtMs ?? null,
        elapsedSeconds: t.elapsedSeconds,
        amount: t.amountAfterRoundingVnd,
        hourlyPrice: t.pricingConfig?.basePriceVnd,
      })),
    });
  }

  return {
    receiptType: 'PAYMENT',
    orderCode: invoice.invoice.displayCode,
    invoiceCode: invoice.invoice.displayCode,
    orderType: invoice.invoice.orderType,
    tableName: invoice.invoice.tableName ?? invoiceSnapshot.order?.tableName ?? null,
    areaName: invoiceSnapshot.order?.areaName ?? null,
    cashierName: invoice.invoice.cashierName ?? invoiceSnapshot.order?.openedByName ?? null,
    customerName: invoiceSnapshot.order?.customerName ?? null,
    guestPhone: invoice.invoice.guestPhone ?? invoiceSnapshot.order?.customerPhone ?? null,
    guestAddress: invoice.invoice.guestAddress ?? null,
    note: invoice.invoice.note ?? invoiceSnapshot.order?.note ?? null,
    checkInTimeMs: invoiceSnapshot.order?.openedAt ?? null,
    issuedAtMs: invoice.invoice.issuedAt,
    subtotal: invoice.invoice.subtotal,
    discountTotal: invoice.invoice.discountTotal,
    promotionDiscount:
      invoiceSnapshot.promotions?.reduce(
        (sum, promotion) => sum + promotion.discountAmountVnd,
        0,
      ) ??
      invoiceSnapshot.promotion?.discountAmountVnd ??
      0,
    promotion: invoiceSnapshot.promotion ?? null,
    promotions:
      invoiceSnapshot.promotions ?? (invoiceSnapshot.promotion ? [invoiceSnapshot.promotion] : []),
    total: invoice.invoice.total,
    paymentMethod: invoice.payment.method,
    cashReceived: invoice.payment.cashReceived ?? null,
    cashChange: invoice.payment.cashChange ?? null,
    lines,
  };
}
