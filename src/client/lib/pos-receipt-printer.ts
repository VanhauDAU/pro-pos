import { createReceiptDocument } from '@domain/receipt/receipt-document';
import {
  formatDateOnly,
  formatSegmentDurationLabel,
  formatTimeOnly,
  reconcileReceiptTimeSegmentAmounts,
  type PosReceiptPrintOptions,
} from '@domain/receipt/receipt-generator';
import { ApiError, apiRequest, jsonRequest } from './api';

let cachedPosCsrfToken: string | null = null;

export function setPosReceiptCsrfToken(token: string | null) {
  cachedPosCsrfToken = token;
}

async function resolvePosCsrfToken(explicitToken?: string | null): Promise<string> {
  if (explicitToken) {
    cachedPosCsrfToken = explicitToken;
    return explicitToken;
  }
  if (cachedPosCsrfToken) return cachedPosCsrfToken;

  try {
    const auth = await apiRequest<{ csrfToken?: string }>('/api/v1/auth/context');
    if (auth?.csrfToken) {
      cachedPosCsrfToken = auth.csrfToken;
      return cachedPosCsrfToken;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Remote Print] Failed to fetch auth context for CSRF token:', error);
    }
  }
  return '';
}

export * from '@domain/receipt/receipt-generator';

function formatVnd(val: number): string {
  return new Intl.NumberFormat('vi-VN').format(val);
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Generates an exact HTML document string matching the store's thermal receipt preview.
 */
export function generateThermalReceiptHtml(
  options: PosReceiptPrintOptions,
  copy?: { index: number; total: number },
): string {
  const document = createReceiptDocument(options);
  const { data, template, profile } = document;
  const printSettings = options.printSettings;
  const customerDisplayName = data.customerName?.trim() || 'Khách lẻ';
  const isK58 = document.isK58;
  const storeName = escapeHtml(document.store.name);
  const storeAddress = escapeHtml(document.store.address);
  const storePhone = escapeHtml(document.store.phone);
  const logoUrl = document.media.logoUrl;
  const bottomImageUrl = document.media.bottomImageUrl;
  const rawCode = data.invoiceCode || data.orderCode;
  const code = escapeHtml(rawCode);

  const isHorizontalHeader = Boolean(printSettings?.logoHorizontalLayout && logoUrl);

  let html = `
    <div class="thermal-receipt-preview thermal-receipt-preview--${isK58 ? 'k58' : 'k80'}">
      <div class="thermal-receipt-inner">
  `;

  // 1. Header (Logo, Store Name, Address, Phone)
  if (isHorizontalHeader && logoUrl) {
    html += `
      <div class="thermal-receipt-header-horizontal">
        <div class="thermal-receipt-logo-thumb">
          <img src="${logoUrl}" alt="" onerror="this.style.display='none'" style="width: ${isK58 ? '32px' : '44px'}; height: ${isK58 ? '32px' : '44px'}; object-fit: contain;" />
        </div>
        <div class="thermal-receipt-store-info">
          <div class="thermal-receipt-store-name">${storeName}</div>
          ${storeAddress ? `<div class="thermal-receipt-store-address">${storeAddress}</div>` : ''}
          ${storePhone ? `<div class="thermal-receipt-store-phone">SĐT: ${storePhone}</div>` : ''}
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="thermal-receipt-header-vertical">
        ${
          logoUrl
            ? `<div class="thermal-receipt-logo-centered">
                <img src="${logoUrl}" alt="" onerror="this.style.display='none'" style="max-width: ${isK58 ? '70px' : '90px'}; max-height: 45px; object-fit: contain; margin: 0 auto 4px; display: block;" />
              </div>`
            : ''
        }
        <div class="thermal-receipt-store-name">${storeName}</div>
        ${storeAddress ? `<div class="thermal-receipt-store-address">${storeAddress}</div>` : ''}
        ${storePhone ? `<div class="thermal-receipt-store-phone">SĐT: ${storePhone}</div>` : ''}
      </div>
    `;
  }

  // 2. Receipt Title & Code
  const title = document.title;

  html += `
    <div class="thermal-receipt-title">${title}</div>
    ${data.receiptType === 'PROVISIONAL' ? '<div class="thermal-receipt-unpaid">CHƯA THANH TOÁN</div>' : ''}
    <div class="thermal-receipt-copy-count">Liên ${copy?.index ?? 1}/${copy?.total ?? 1}</div>
    <div class="thermal-receipt-code-line">
      <span>Số: ${code}</span>
      <span>${formatDateTime(data.issuedAtMs)}</span>
    </div>
    <div class="thermal-receipt-divider-dash"></div>
  `;

  // 3. Meta Information
  html += `<div class="thermal-receipt-meta">`;
  if (template.showTableAreaName && (data.tableName || data.areaName)) {
    const tableArea = escapeHtml([data.tableName, data.areaName].filter(Boolean).join(' · '));
    html += `
      <div class="thermal-receipt-row">
        <span class="thermal-receipt-label">Khu vực / Bàn</span>
        <span class="thermal-receipt-value" style="font-weight: 700;">${tableArea}</span>
      </div>
    `;
  }
  if (template.showCashierName && data.cashierName) {
    html += `
      <div class="thermal-receipt-row">
        <span class="thermal-receipt-label">Thu ngân</span>
        <span class="thermal-receipt-value">${escapeHtml(data.cashierName)}</span>
      </div>
    `;
  }
  if (template.showCheckInTime && data.checkInTimeMs) {
    html += `
      <div class="thermal-receipt-row">
        <span class="thermal-receipt-label">Giờ vào</span>
        <span class="thermal-receipt-value">${formatDateTime(data.checkInTimeMs)}</span>
      </div>
    `;
  }

  if (
    (template.showCustomerPhone && data.guestPhone) ||
    (template.showCustomerAddress && data.guestAddress) ||
    template.showCustomerName ||
    (template.showOrderNote && data.note)
  ) {
    html += `<div class="thermal-receipt-divider-dash"></div>`;
    if (template.showCustomerName) {
      html += `
        <div class="thermal-receipt-row">
          <span class="thermal-receipt-label">Khách hàng</span>
          <span class="thermal-receipt-value">${escapeHtml(customerDisplayName)}</span>
        </div>
      `;
    }
    if (template.showCustomerPhone && data.guestPhone) {
      html += `
        <div class="thermal-receipt-row">
          <span class="thermal-receipt-label">Điện thoại</span>
          <span class="thermal-receipt-value">${escapeHtml(data.guestPhone)}</span>
        </div>
      `;
    }
    if (template.showCustomerAddress && data.guestAddress) {
      html += `
        <div class="thermal-receipt-row">
          <span class="thermal-receipt-label">Địa chỉ</span>
          <span class="thermal-receipt-value">${escapeHtml(data.guestAddress)}</span>
        </div>
      `;
    }
    if (template.showOrderNote && data.note) {
      html += `
        <div class="thermal-receipt-row" style="font-style: italic; margin-top: 2px;">
          <span>*Ghi chú:</span>
          <span>${escapeHtml(data.note)}</span>
        </div>
      `;
    }
  }

  html += `</div><div class="thermal-receipt-divider-dash"></div>`;

  // Filter time lines vs product lines
  const timeLines = data.lines.filter((l) => l.isTime);
  const productLines = data.lines.filter((l) => !l.isTime);
  const timeTotal = timeLines.reduce((sum, line) => sum + line.totalPrice, 0);
  const goodsTotal = productLines.reduce((sum, line) => sum + line.totalPrice, 0);

  const itemFontSizePx = isK58
    ? template.itemFontSize === 'SMALL'
      ? '8px'
      : template.itemFontSize === 'LARGE'
        ? '10px'
        : '8.5px'
    : template.itemFontSize === 'SMALL'
      ? '9.5px'
      : template.itemFontSize === 'LARGE'
        ? '12px'
        : '10.5px';
  const itemFontSizeClass = `thermal-receipt-items--${template.itemFontSize.toLowerCase()}`;

  // 4. Section: Hourly Services (Thông tin giờ)
  if (timeLines.length > 0) {
    html += `
      <div class="thermal-receipt-items thermal-receipt-items--time ${itemFontSizeClass} ${!isK58 && template.showHourlyUnitPrice ? 'thermal-receipt-items--with-unit-price' : ''}" style="font-size: ${itemFontSizePx};">
        <div class="thermal-receipt-table-header">
          <span class="thermal-receipt-col-name" style="flex: 1;">Thông tin giờ</span>
          ${!isK58 && template.showHourlyUnitPrice ? `<span class="thermal-receipt-col-unit-price" style="width: 65px; text-align: right;">Đ.Giá</span>` : ''}
          <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'}; text-align: right;">${isK58 ? 'T.Tiền' : 'Thành tiền'}</span>
        </div>
    `;

    for (const line of timeLines) {
      if (
        line.tableSegments &&
        line.tableSegments.length > 1 &&
        (!line.timeSegments || line.timeSegments.length === 0)
      ) {
        // Table transfers
        html += `
          <div class="thermal-receipt-item-row" style="margin-top: 3px;">
            <div class="thermal-receipt-item-main">
              <span class="thermal-receipt-col-name" style="flex: 1; font-weight: 600;">Chuyển bàn</span>
              <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
            </div>
        `;
        if (template.showHourlyDetail) {
          for (const tSeg of line.tableSegments) {
            html += `
              <div class="thermal-receipt-item-sub">
                • ${escapeHtml(tSeg.tableName)}: ${formatClock(tSeg.startedAtMs)}–${tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'} (${formatDuration(tSeg.elapsedSeconds)})${tSeg.hourlyPrice ? ` @ ${formatVnd(tSeg.hourlyPrice)}/h` : ''} = ${formatVnd(tSeg.amount)}
              </div>
            `;
          }
          html += `<div class="thermal-receipt-item-sub" style="color: #64748b;">= Tổng thời gian: ${formatDuration(line.timeElapsedSeconds || 0)}</div>`;
        }
        html += `</div>`;
      } else if (
        template.showHourlyDetail &&
        template.hourlyDetailMode === 'FULL_TIMELOG' &&
        line.timeSegments &&
        line.timeSegments.length > 0
      ) {
        const displaySegments =
          reconcileReceiptTimeSegmentAmounts(line.timeSegments, line.totalPrice) ?? [];
        html += `
          <div class="thermal-receipt-item-row" style="margin-top: 3px;">
            ${displaySegments
              .map((seg, sIdx) => {
                const startStr = formatTimeOnly(
                  seg.startedAtMs,
                  template.showHourlyTimeWithSeconds,
                );
                const endStr = seg.endedAtMs
                  ? formatTimeOnly(seg.endedAtMs, template.showHourlyTimeWithSeconds)
                  : 'Hiện tại';
                const timeRangeStr = `${startStr} - ${endStr}`;
                const dateStr = formatDateOnly(seg.startedAtMs);
                const durationLabel = formatSegmentDurationLabel(seg);
                return `
                  <div class="thermal-receipt-time-segment" style="margin-top: ${sIdx > 0 ? '6px' : '3px'};">
                    <div class="thermal-receipt-time-row" style="display: flex; align-items: baseline;">
                      <span class="thermal-receipt-col-name" style="flex: 1;">${timeRangeStr}</span>
                      ${!isK58 && template.showHourlyUnitPrice ? `<span class="thermal-receipt-col-unit-price" style="width: 65px; text-align: right; white-space: nowrap;">${formatVnd(seg.priceVnd)}${template.showHourlyUnitDuration ? '/1h' : ''}</span>` : ''}
                      <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(seg.amount)}</span>
                    </div>
                    <div>${dateStr}</div>
                    <div class="thermal-receipt-time-row" style="display: flex; align-items: baseline;">
                      <span class="thermal-receipt-col-name" style="flex: 1; color: #64748b;">${durationLabel}</span>
                      ${!isK58 && template.showHourlyUnitPrice ? `<span class="thermal-receipt-col-unit-price" style="width: 65px;"></span>` : ''}
                      <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'};"></span>
                    </div>
                    ${isK58 && template.showHourlyUnitPrice ? `<div class="thermal-receipt-item-sub">Đ.Giá: ${formatVnd(seg.priceVnd)}${template.showHourlyUnitDuration ? '/1h' : ''}</div>` : ''}
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      } else {
        const timeSummaryLabel = line.timeElapsedSeconds
          ? `Tổng thời gian (${formatDuration(line.timeElapsedSeconds)})`
          : 'Tổng thời gian';
        html += `
          <div class="thermal-receipt-item-row" style="margin-top: 3px;">
            <div class="thermal-receipt-item-main">
              <span class="thermal-receipt-col-name" style="flex: 1; font-weight: 600;">${timeSummaryLabel}</span>
              ${!isK58 && template.showHourlyUnitPrice ? `<span class="thermal-receipt-col-unit-price" style="width: 65px; text-align: right;">${formatVnd(line.unitPrice)}${template.showHourlyUnitDuration ? '/1h' : ''}</span>` : ''}
              <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
            </div>
            ${isK58 && template.showHourlyUnitPrice ? `<div class="thermal-receipt-item-sub">Đ.Giá: ${formatVnd(line.unitPrice)}${template.showHourlyUnitDuration ? '/1h' : ''}</div>` : ''}
            ${
              template.showHourlyDetail
                ? template.hourlyDetailMode === 'FULL_TIMELOG'
                  ? `<div class="thermal-receipt-item-sub">
                      ${line.timeStartedAtMs ? `<div>${formatDateTime(line.timeStartedAtMs, template.showHourlyTimeWithSeconds)} - ${line.timeEndedAtMs ? formatDateTime(line.timeEndedAtMs, template.showHourlyTimeWithSeconds) : 'Hiện tại'}</div>` : ''}
                      <div style="color: #64748b;">= ${formatDuration(line.timeElapsedSeconds || 0)}</div>
                    </div>`
                  : `<div class="thermal-receipt-item-sub" style="color: #64748b;">= ${formatDuration(line.timeElapsedSeconds || 0)}</div>`
                : ''
            }
          </div>
        `;
      }
    }

    html += `</div><div class="thermal-receipt-divider-dash"></div>`;
  }

  // 5. Section: Products / Goods (Mặt hàng)
  if (productLines.length > 0) {
    html += `
      <div class="thermal-receipt-items thermal-receipt-items--products ${itemFontSizeClass} ${!isK58 && template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN' ? 'thermal-receipt-items--with-unit-price' : ''} ${template.showItemTableBorder ? 'thermal-receipt-items--bordered' : ''}" style="font-size: ${itemFontSizePx};">
        <div class="thermal-receipt-table-header">
          <span class="thermal-receipt-col-name" style="flex: 1;">Mặt hàng</span>
          <span class="thermal-receipt-col-quantity" style="width: ${isK58 ? '24px' : '45px'}; text-align: center;">${isK58 ? 'SL' : 'SL/TL'}</span>
          ${!isK58 && template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN' ? `<span class="thermal-receipt-col-unit-price" style="width: 60px; text-align: right;">Đ.Giá</span>` : ''}
          <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'}; text-align: right;">${isK58 ? 'T.Tiền' : 'Thành tiền'}</span>
        </div>
    `;

    let itemIdx = 1;
    for (const line of productLines) {
      if (template.hideZeroPriceItems && line.totalPrice === 0) continue;

      const prefix = template.showItemIndex ? `${itemIdx}. ` : '';
      itemIdx++;

      html += `
        <div class="thermal-receipt-item-row" style="margin-top: 3px;">
          <div class="thermal-receipt-item-main">
            <span class="thermal-receipt-col-name" style="flex: 1; font-weight: 600;">${prefix}${escapeHtml(line.name)}${template.showItemPriceName ? ' (Giá chuẩn)' : ''}</span>
            <span class="thermal-receipt-col-quantity" style="width: ${isK58 ? '24px' : '45px'}; text-align: center;">${line.quantity}</span>
            ${!isK58 && template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN' ? `<span class="thermal-receipt-col-unit-price" style="width: 60px; text-align: right;">${formatVnd(line.unitPrice)}</span>` : ''}
            <span class="thermal-receipt-col-total" style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
          </div>
          ${
            template.showItemUnitPrice && (template.itemUnitPricePlacement === 'INLINE' || isK58)
              ? `<div class="thermal-receipt-item-sub">Đơn giá: ${formatVnd(line.unitPrice)}</div>`
              : ''
          }
          ${
            template.showItemNote && line.note
              ? `<div class="thermal-receipt-item-sub" style="font-style: italic;">* G/chú: ${escapeHtml(line.note)}</div>`
              : ''
          }
          ${
            template.showItemDiscounts && (line.discountAmount ?? 0) > 0
              ? line.adjustmentSource === 'PROMOTION_GIFT'
                ? `<div class="thermal-receipt-item-sub" style="color: #389e0d;">* Quà tặng khuyến mãi: -${formatVnd(line.discountAmount ?? 0)}đ</div>
                   <div class="thermal-receipt-item-sub">* Chương trình: ${escapeHtml(line.promotionName || 'Khuyến mãi tặng món')}</div>`
                : `<div class="thermal-receipt-item-sub" style="color: #d4380d;">* Giảm thủ công: -${formatVnd(line.discountAmount ?? 0)}đ</div>
                   <div class="thermal-receipt-item-sub">* Lý do: ${escapeHtml(line.discountReason || 'Chưa có lý do')}</div>`
              : ''
          }
        </div>
      `;
    }

    html += `</div><div class="thermal-receipt-divider-dash"></div>`;
  }

  // 5. Summary & Totals
  html += `<div class="thermal-receipt-summary">`;
  if (timeLines.length > 0) {
    html += `<div class="thermal-receipt-row"><span>Tiền giờ</span><span>${formatVnd(timeTotal)}đ</span></div>`;
  }
  if (productLines.length > 0) {
    html += `<div class="thermal-receipt-row"><span>Tiền hàng (${productLines.length})</span><span>${formatVnd(goodsTotal)}đ</span></div>`;
  }
  if (
    template.combineGoodsAndServiceTotal &&
    timeLines.length > 0 &&
    productLines.length > 0 &&
    (data.receiptType !== 'PAYMENT' || data.discountTotal > 0)
  ) {
    html += `<div class="thermal-receipt-row" style="font-weight: 600;"><span>Tổng tiền hàng &amp; dịch vụ</span><span>${formatVnd(timeTotal + goodsTotal)}đ</span></div>`;
  }
  const promotionDiscount = data.promotionDiscount ?? 0;
  if (template.showProvisionalTotal && promotionDiscount > 0) {
    html += `
      <div class="thermal-receipt-row">
        <span>Tổng tạm tính</span>
        <span>${formatVnd(timeTotal + goodsTotal)}đ</span>
      </div>
    `;
  }
  if (template.showPromotionsList && promotionDiscount > 0) {
    const promotionLines =
      data.promotions && data.promotions.length > 0
        ? data.promotions
        : data.promotion
          ? [data.promotion]
          : [{ name: 'Khuyến mại', type: '', value: null, discountAmountVnd: promotionDiscount }];
    for (const promotion of promotionLines) {
      if (promotion.type === 'FLAT_PRICE' && (promotion.flatPriceItems?.length ?? 0) > 0) {
        html += `
          <div class="thermal-receipt-row" style="color: #e11d48; font-weight: 600;">
            <span>${escapeHtml(`KM: ${promotion.name}`)}</span>
            <span>Đồng giá ${formatVnd(promotion.value ?? 0)}đ</span>
          </div>
        `;
        for (const item of promotion.flatPriceItems ?? []) {
          const variant = item.variantName ? ` · ${item.variantName}` : '';
          html += `
            <div class="thermal-receipt-item-sub">
              - ${escapeHtml(`${item.productName}${variant}`)} · SL: ${item.quantityMilli / 1000}
            </div>
          `;
        }
        html += `
          <div class="thermal-receipt-row" style="color: #e11d48;">
            <span>Giảm khuyến mãi</span>
            <span>-${formatVnd(promotion.discountAmountVnd)}đ</span>
          </div>
        `;
        continue;
      }
      html += `
        <div class="thermal-receipt-row" style="color: #e11d48;">
          <span>${escapeHtml(`KM: ${promotion.name}`)}</span>
          <span>-${formatVnd(promotion.discountAmountVnd)}đ</span>
        </div>
      `;
    }
  }

  const grandLabel =
    data.receiptType === 'PROVISIONAL'
      ? 'TỔNG TẠM TÍNH'
      : data.receiptType === 'DEBT_PAYMENT'
        ? 'SỐ TIỀN THU'
        : 'TỔNG CỘNG';
  html += `
    <div class="thermal-receipt-grand-total">
      <span>${grandLabel}</span>
      <span class="thermal-receipt-grand-total-amount">${formatVnd(data.total)}đ</span>
    </div>
  `;

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
              : 'Chuyển khoản đã thu';
        html += `<div class="thermal-receipt-row"><span>${label}</span><strong>${formatVnd(allocation.amountVnd)}đ</strong></div>`;
      }
    } else if (allocations.length === 0 && (data.debtAmountVnd ?? 0) > 0) {
      if ((data.paidAmountVnd ?? 0) > 0) {
        html += `<div class="thermal-receipt-row"><span>Đã thu</span><strong>${formatVnd(data.paidAmountVnd!)}đ</strong></div>`;
      }
      html += `<div class="thermal-receipt-row"><span>Ghi công nợ</span><strong>${formatVnd(data.debtAmountVnd!)}đ</strong></div>`;
    }
  }
  if (data.receiptType === 'DEBT_PAYMENT') {
    html += `
      <div class="thermal-receipt-divider-dash"></div>
      <div class="thermal-receipt-row"><span>Dư nợ trước</span><span>${formatVnd(data.debtBeforeVnd ?? 0)}đ</span></div>
      <div class="thermal-receipt-row"><span>Số tiền vừa thu</span><strong>${formatVnd(data.debtPaymentVnd ?? data.total)}đ</strong></div>
      <div class="thermal-receipt-row"><span>Dư nợ còn lại</span><strong>${formatVnd(data.debtAfterVnd ?? 0)}đ</strong></div>
      ${data.referenceCode ? `<div class="thermal-receipt-row"><span>Mã tham chiếu</span><span>${escapeHtml(data.referenceCode)}</span></div>` : ''}
      ${template.showPaymentMethod ? `<div class="thermal-receipt-row"><span>Phương thức</span><span>${data.paymentMethod === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'}</span></div>` : ''}
    `;
  }

  // Payment Details
  if (
    data.receiptType === 'PAYMENT' &&
    template.showPaymentMethod &&
    data.paymentMethod &&
    (data.paymentAllocations?.length ?? 0) <= 1 &&
    !data.paymentAllocations?.some((allocation) => allocation.method === 'DEBT')
  ) {
    const methodStr = data.paymentMethod === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản (VietQR)';
    html += `
      <div class="thermal-receipt-row" style="margin-top: 3px;">
        <span>Hình thức thanh toán</span>
        <span style="font-weight: 600;">${methodStr}</span>
      </div>
    `;
    if (data.paymentMethod === 'CASH' && template.showCashDetails) {
      if (data.cashReceived !== null && data.cashReceived !== undefined) {
        html += `
          <div class="thermal-receipt-row">
            <span>Tiền khách đưa</span>
            <span>${formatVnd(data.cashReceived)}đ</span>
          </div>
        `;
      }
      if (data.cashChange !== null && data.cashChange !== undefined) {
        html += `
          <div class="thermal-receipt-row">
            <span>Tiền thừa</span>
            <span>${formatVnd(data.cashChange)}đ</span>
          </div>
        `;
      }
    }
  }

  html += `</div>`;

  // 6. Star Divider
  html += `<div class="thermal-receipt-star-divider">----------------*----------------</div>`;

  // 7. VietQR / Bottom Image
  if (bottomImageUrl) {
    html += `
      <div class="thermal-receipt-bottom-qr-container" style="text-align: center; margin: 6px 0 3px;">
        <img src="${bottomImageUrl}" alt="" onerror="this.style.display='none'" class="thermal-receipt-bottom-qr-img" style="width: ${profile.maxQrSizePx}px; height: ${profile.maxQrSizePx}px; object-fit: contain; margin: 0 auto; display: block;" />
        ${document.media.bottomDescription ? `<div class="thermal-receipt-qr-desc" style="font-size: 9px; margin-top: 2px;">${escapeHtml(document.media.bottomDescription)}</div>` : ''}
      </div>
    `;
  }

  // 8. Wi-Fi
  if (document.wifi) {
    html += `
      <div class="thermal-receipt-wifi">
        <span>Wi-Fi: <strong>${escapeHtml(document.wifi.name || 'Cửa hàng')}</strong></span>
        ${document.wifi.password ? `<span>Pass: <strong>${escapeHtml(document.wifi.password)}</strong></span>` : ''}
      </div>
    `;
  }

  // 9. Footer text
  for (const footerLine of document.footer) {
    html += `
      <div class="thermal-receipt-footer-text" style="${footerLine.bold ? 'font-weight: 700;' : 'font-weight: 400;'}">
        ${escapeHtml(footerLine.text)}
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

import { triggerBrowserPrint } from '@printing/transports/browser-transport';

/** Browser print manual fallback */
export async function browserPrintFallback(options: PosReceiptPrintOptions): Promise<{
  success: boolean;
  message?: string;
}> {
  try {
    const html = generateThermalReceiptHtml(options);
    await triggerBrowserPrint(html);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Không thể in bằng trình duyệt.',
    };
  }
}

/** Sends an async remote print job to the server for processing by the active Pro POS Print Agent. */
export async function dispatchRemotePrintJob(params: {
  documentType: 'invoice' | 'provisional' | 'debt_payment';
  documentId: string;
  printerRole?: string;
  targetDeviceId?: string | null;
  csrfToken?: string | null;
}): Promise<{ success: boolean; jobId?: string; message?: string }> {
  const idempotencyKey = `print:${params.documentType}:${params.documentId}:${crypto.randomUUID()}`;
  let csrfToken = await resolvePosCsrfToken(params.csrfToken);

  const executePost = async (token: string) => {
    return jsonRequest<{ jobId: string; status: string }>(
      '/api/v1/pos/print-jobs',
      {
        documentType: params.documentType,
        documentId: params.documentId,
        printerRole: params.printerRole ?? 'receipt',
        targetDeviceId: params.targetDeviceId ?? null,
        idempotencyKey,
      },
      {
        headers: {
          'Idempotency-Key': idempotencyKey,
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
      },
    );
  };

  try {
    let result: { jobId: string; status: string };
    try {
      result = await executePost(csrfToken);
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 403 || err.code === 'CSRF_TOKEN_INVALID')) {
        if (import.meta.env.DEV) {
          console.warn('[Print Job] CSRF token expired or missing, refreshing auth context...');
        }
        cachedPosCsrfToken = null;
        csrfToken = await resolvePosCsrfToken();
        result = await executePost(csrfToken);
      } else {
        throw err;
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Print Job] Job submitted successfully (status=201, QUEUED):', result.jobId);
    }

    return {
      success: true,
      jobId: result.jobId,
      message: 'Đã gửi yêu cầu in tới Print Agent.',
    };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[Print Job] Submit failed:', error);
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Không thể gửi yêu cầu in.',
    };
  }
}

/**
 * Unified printing entrypoint: Routes all invoice/quote prints through the Pro POS Print Agent pipeline.
 * If user desires manual browser printing, they can explicitly use browserPrintFallback.
 */
export async function smartPrintReceipt(
  options: PosReceiptPrintOptions,
  documentIdentity?: {
    type: 'invoice' | 'provisional' | 'debt_payment';
    id: string;
  },
  csrfToken?: string | null,
): Promise<{ success: boolean; isRemote?: boolean; message?: string }> {
  if (documentIdentity) {
    const res = await dispatchRemotePrintJob({
      documentType: documentIdentity.type,
      documentId: documentIdentity.id,
      csrfToken: csrfToken ?? (options as any).csrfToken,
    });
    return { ...res, isRemote: true };
  }

  // Fallback to browser print if no document identity is passed
  const fallbackRes = await browserPrintFallback(options);
  return { ...fallbackRes, isRemote: false };
}

export const printReceipt = smartPrintReceipt;
