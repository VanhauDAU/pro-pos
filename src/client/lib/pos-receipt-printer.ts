import {
  type PaperSize,
  getReceiptPrintProfile,
  parsePrintTemplateConfigs,
  parsePrinterDeviceConfig,
} from '@contracts/store';
import { buildEscPosReceipt, type PosReceiptPrintOptions } from '@domain/receipt/receipt-generator';
import { checkQzTrayStatus, printEscPosReceipt } from './qz-tray-service';

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

function thermalReceiptDocument(html: string, paperSize: PaperSize, printableWidthMm: number) {
  const isK58 = paperSize === 'K58';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${paperSize === 'K58' ? 58 : 80}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: ${printableWidthMm}mm; background: #fff; color: #000; }
    body { font-family: Arial, "Helvetica Neue", sans-serif; font-size: ${isK58 ? 9.5 : 11}px; line-height: 1.25; }
    .thermal-receipt-preview { width: ${printableWidthMm}mm; max-width: ${printableWidthMm}mm; padding: 2mm 0; margin: 0; border: 0; box-shadow: none; }
    .thermal-receipt-inner { display: flex; flex-direction: column; gap: 2px; }
    .thermal-receipt-header-vertical, .thermal-receipt-title, .thermal-receipt-copy-count, .thermal-receipt-star-divider, .thermal-receipt-footer-text, .thermal-receipt-wifi { text-align: center; }
    .thermal-receipt-header-horizontal { display: flex; align-items: center; gap: 2mm; }
    .thermal-receipt-store-info { flex: 1; min-width: 0; }
    .thermal-receipt-store-name { font-size: ${isK58 ? 11 : 13.5}px; font-weight: 700; text-transform: uppercase; }
    .thermal-receipt-store-address, .thermal-receipt-store-phone { font-size: ${isK58 ? 9 : 11}px; }
    .thermal-receipt-title { font-size: ${isK58 ? 11.5 : 14.5}px; font-weight: 800; margin-top: 1mm; }
    .thermal-receipt-copy-count { font-size: ${isK58 ? 9 : 11}px; }
    .thermal-receipt-divider-dash { border-bottom: 1px dashed #000; margin: 1mm 0; }
    .thermal-receipt-meta, .thermal-receipt-summary { display: flex; flex-direction: column; gap: .5mm; }
    .thermal-receipt-row, .thermal-receipt-item-main, .thermal-receipt-table-header, .thermal-receipt-grand-total { display: flex; justify-content: space-between; gap: 1mm; }
    .thermal-receipt-table-header { font-weight: 700; border-bottom: 1px dashed #000; }
    .thermal-receipt-item-row { margin-bottom: .7mm; }
    .thermal-receipt-item-sub { font-size: ${isK58 ? 8.5 : 10}px; padding-left: 1mm; }
    .thermal-receipt-items--bordered { border: 1px solid #000; padding: 1mm; }
    .thermal-receipt-grand-total { font-size: ${isK58 ? 11 : 13.5}px; font-weight: 800; }
    .thermal-receipt-bottom-qr-img { display: block; margin: 0 auto; }
    .thermal-receipt-wifi { margin: 1mm 0; }
  </style></head><body>${html}</body></html>`;
}

async function inlineReceiptImages(html: string) {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return html;
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const images = Array.from(documentNode.querySelectorAll('img'));
  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute('src');
      if (!source || source.startsWith('data:')) return;
      try {
        const response = await fetch(new URL(source, window.location.origin), {
          credentials: 'include',
        });
        if (!response.ok) return;
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
          reader.addEventListener('error', () => reject(reader.error), { once: true });
          reader.readAsDataURL(blob);
        });
        image.setAttribute('src', dataUrl);
      } catch {
        image.setAttribute('src', new URL(source, window.location.origin).href);
      }
    }),
  );
  return `<!doctype html>${documentNode.documentElement.outerHTML}`;
}

/**
 * Generates an exact HTML document string matching the store's thermal receipt preview.
 */
export function generateThermalReceiptHtml(
  options: PosReceiptPrintOptions,
  copy?: { index: number; total: number },
): string {
  const { data, printSettings, storeInfo } = options;
  const templateConfigs = parsePrintTemplateConfigs(printSettings?.templateConfigJson);
  const template =
    data.receiptType === 'PROVISIONAL' ? templateConfigs.PROVISIONAL : templateConfigs.PAYMENT;

  const printerConfig = parsePrinterDeviceConfig(printSettings?.printersJson);
  const paperSize: PaperSize = printSettings?.paperSize || printerConfig.paperSize || 'K80';
  const isK58 = paperSize === 'K58';
  const profile = getReceiptPrintProfile(paperSize, printerConfig.printableDots);

  const storeName = escapeHtml(storeInfo?.storeName || 'PRO POS');
  const storeAddress = escapeHtml(
    printSettings?.customAddressEnabled ? printSettings.customAddress : storeInfo?.address,
  );
  const storePhone = escapeHtml(storeInfo?.phone);

  // Resolve Logo URL
  let logoUrl: string | null = null;
  if (template.showLogo && printSettings?.logoMediaId) {
    logoUrl = `/api/v1/media/${printSettings.logoMediaId}`;
  }

  // Resolve Bottom Image / VietQR URL
  const rawCode = data.invoiceCode || data.orderCode;
  const code = escapeHtml(rawCode);
  let bottomImageUrl: string | null = null;
  if (template.showBottomImage) {
    if (printSettings?.bottomImageType === 'UPLOAD' && printSettings?.bottomImageMediaId) {
      bottomImageUrl = `/api/v1/media/${printSettings.bottomImageMediaId}`;
    } else {
      const bank = (printSettings?.bottomBankName || storeInfo?.bankName || '').trim();
      const account = (
        printSettings?.bottomBankAccountNumber ||
        storeInfo?.bankAccountNumber ||
        ''
      ).trim();
      const accountName = (
        printSettings?.bottomBankAccountName ||
        storeInfo?.bankAccountName ||
        ''
      ).trim();

      if (bank && account) {
        bottomImageUrl = `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-qr_only.png?amount=${data.total}&addInfo=${encodeURIComponent(rawCode)}&accountName=${encodeURIComponent(accountName)}`;
      }
    }
  }

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
  const title = data.receiptType === 'PROVISIONAL' ? 'HÓA ĐƠN TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN';

  html += `
    <div class="thermal-receipt-title">${title}</div>
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
    data.customerName ||
    (template.showOrderNote && data.note)
  ) {
    html += `<div class="thermal-receipt-divider-dash"></div>`;
    if (data.customerName) {
      html += `
        <div class="thermal-receipt-row">
          <span class="thermal-receipt-label">Khách hàng</span>
        <span class="thermal-receipt-value">${escapeHtml(data.customerName)}</span>
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

  // 4. Section: Hourly Services (Thông tin giờ)
  if (timeLines.length > 0) {
    html += `
      <div class="thermal-receipt-items" style="font-size: ${itemFontSizePx};">
        <div class="thermal-receipt-table-header">
          <span style="flex: 1;">Thông tin giờ</span>
          ${!isK58 && template.showHourlyUnitPrice ? `<span style="width: 65px; text-align: right;">Đ.Giá</span>` : ''}
          <span style="width: ${isK58 ? '48px' : '65px'}; text-align: right;">T.Tiền</span>
        </div>
    `;

    let timeIdx = 1;
    for (const line of timeLines) {
      const prefix = template.showItemIndex ? `${timeIdx}. ` : '';
      timeIdx++;

      if (line.tableSegments && line.tableSegments.length > 1) {
        // Table transfers
        html += `
          <div class="thermal-receipt-item-row" style="margin-top: 3px;">
            <div class="thermal-receipt-item-main">
              <span style="flex: 1; font-weight: 600;">${prefix}Tiền giờ (Chuyển bàn)</span>
              <span style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
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
      } else {
        html += `
          <div class="thermal-receipt-item-row" style="margin-top: 3px;">
            <div class="thermal-receipt-item-main">
              <span style="flex: 1; font-weight: 600;">${prefix}${escapeHtml(line.name)}</span>
              ${!isK58 && template.showHourlyUnitPrice ? `<span style="width: 65px; text-align: right;">${formatVnd(line.unitPrice)}${template.showHourlyUnitDuration ? '/1h' : ''}</span>` : ''}
              <span style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
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
      <div class="thermal-receipt-items ${template.showItemTableBorder ? 'thermal-receipt-items--bordered' : ''}" style="font-size: ${itemFontSizePx};">
        <div class="thermal-receipt-table-header">
          <span style="flex: 1;">Mặt hàng</span>
          <span style="width: ${isK58 ? '24px' : '45px'}; text-align: center;">${isK58 ? 'SL' : 'SL/TL'}</span>
          ${!isK58 && template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN' ? `<span style="width: 60px; text-align: right;">Đ.Giá</span>` : ''}
          <span style="width: ${isK58 ? '48px' : '65px'}; text-align: right;">T.Tiền</span>
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
            <span style="flex: 1; font-weight: 600;">${prefix}${escapeHtml(line.name)}${template.showItemPriceName ? ' (Giá chuẩn)' : ''}</span>
            <span style="width: ${isK58 ? '24px' : '45px'}; text-align: center;">${line.quantity}</span>
            ${!isK58 && template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN' ? `<span style="width: 60px; text-align: right;">${formatVnd(line.unitPrice)}</span>` : ''}
            <span style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
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
        </div>
      `;
    }

    html += `</div><div class="thermal-receipt-divider-dash"></div>`;
  }

  // 5. Summary & Totals
  html += `<div class="thermal-receipt-summary">`;
  if (timeLines.length > 0) {
    html += `<div class="thermal-receipt-row"><span>Tiền giờ (${timeLines.length})</span><span>${formatVnd(timeTotal)}đ</span></div>`;
  }
  if (productLines.length > 0) {
    html += `<div class="thermal-receipt-row"><span>Tiền hàng (${productLines.length})</span><span>${formatVnd(goodsTotal)}đ</span></div>`;
  }
  if (template.combineGoodsAndServiceTotal && timeLines.length > 0 && productLines.length > 0) {
    html += `<div class="thermal-receipt-row" style="font-weight: 600;"><span>Tổng tiền hàng &amp; dịch vụ</span><span>${formatVnd(timeTotal + goodsTotal)}đ</span></div>`;
  }
  if (template.showProvisionalTotal && data.discountTotal > 0) {
    html += `
      <div class="thermal-receipt-row">
        <span>Tổng tạm tính</span>
        <span>${formatVnd(data.subtotal)}đ</span>
      </div>
    `;
  }
  if (template.showPromotionsList && data.discountTotal > 0) {
    html += `
      <div class="thermal-receipt-row" style="color: #e11d48;">
        <span>Chiết khấu / Giảm giá</span>
        <span>-${formatVnd(data.discountTotal)}đ</span>
      </div>
    `;
  }

  const grandLabel = data.receiptType === 'PROVISIONAL' ? 'TỔNG TẠM TÍNH' : 'TỔNG CỘNG';
  html += `
    <div class="thermal-receipt-grand-total">
      <span>${grandLabel}</span>
      <span class="thermal-receipt-grand-total-amount">${formatVnd(data.total)}đ</span>
    </div>
  `;

  // Payment Details
  if (data.receiptType === 'PAYMENT' && data.paymentMethod) {
    const methodStr = data.paymentMethod === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản (VietQR)';
    html += `
      <div class="thermal-receipt-row" style="margin-top: 3px;">
        <span>Hình thức thanh toán</span>
        <span style="font-weight: 600;">${methodStr}</span>
      </div>
    `;
    if (data.paymentMethod === 'CASH') {
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
        ${printSettings?.bottomImageDescription ? `<div class="thermal-receipt-qr-desc" style="font-size: 9px; margin-top: 2px;">${escapeHtml(printSettings.bottomImageDescription)}</div>` : ''}
      </div>
    `;
  }

  // 8. Wi-Fi
  if (printSettings?.printWifiEnabled && (printSettings.wifiName || printSettings.wifiPassword)) {
    html += `
      <div class="thermal-receipt-wifi">
        <span>Wi-Fi: <strong>${escapeHtml(printSettings.wifiName || 'Cửa hàng')}</strong></span>
        ${printSettings.wifiPassword ? `<span>Pass: <strong>${escapeHtml(printSettings.wifiPassword)}</strong></span>` : ''}
      </div>
    `;
  }

  // 9. Footer text
  if (printSettings?.footerLine1) {
    html += `
      <div class="thermal-receipt-footer-text" style="${printSettings.footerLine1Bold ? 'font-weight: 700;' : ''}">
        ${escapeHtml(printSettings.footerLine1)}
      </div>
    `;
  }
  if (printSettings?.footerLine2) {
    html += `
      <div class="thermal-receipt-footer-text" style="${printSettings.footerLine2Bold ? 'font-weight: 700;' : ''}">
        ${escapeHtml(printSettings.footerLine2)}
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * Triggers printing using either QZ Tray direct hardware connection, or browser thermal print fallback.
 */
export async function printReceipt(options: PosReceiptPrintOptions): Promise<{
  success: boolean;
  message?: string;
}> {
  const printerConfig = parsePrinterDeviceConfig(options.printSettings?.printersJson);
  const paperSize: PaperSize = options.printSettings?.paperSize || printerConfig.paperSize || 'K80';
  if (
    options.data.receiptType === 'PROVISIONAL' &&
    options.printSettings?.allowProvisionalPrint === false
  ) {
    return { success: false, message: 'Cửa hàng đang tắt chức năng in hóa đơn tạm tính.' };
  }
  const copies = Math.max(
    1,
    options.data.receiptType === 'PROVISIONAL'
      ? (options.printSettings?.provisionalCopyCount ?? 1)
      : (options.printSettings?.paymentCopyCount ?? 1),
  );

  // Check if QZ Tray is active
  try {
    const qzStatus = await checkQzTrayStatus();
    if (qzStatus.connected) {
      const profile = getReceiptPrintProfile(paperSize, printerConfig.printableDots);
      const escPosCopies =
        printerConfig.connectionType === 'NETWORK_TCP'
          ? Array.from(
              { length: copies },
              (_, index) =>
                buildEscPosReceipt(options, { index: index + 1, total: copies }).escPosData,
            )
          : [];
      const htmlCopies =
        printerConfig.connectionType === 'SYSTEM'
          ? await Promise.all(
              Array.from({ length: copies }, (_, index) =>
                inlineReceiptImages(
                  thermalReceiptDocument(
                    generateThermalReceiptHtml(options, { index: index + 1, total: copies }),
                    paperSize,
                    profile.printableWidthMm,
                  ),
                ),
              ),
            )
          : [];
      const qzResult = await printEscPosReceipt({
        connectionType: printerConfig.connectionType,
        printerName: printerConfig.printerName,
        networkIp: printerConfig.networkIp,
        networkPort: printerConfig.networkPort,
        paperSize,
        printableDots: printerConfig.printableDots,
        autoCut: printerConfig.autoCut,
        openCashDrawer: printerConfig.openCashDrawer && options.data.receiptType === 'PAYMENT',
        storeName: options.storeInfo?.storeName || 'PRO POS',
        escPosData: escPosCopies,
        htmlData: htmlCopies,
        paperWidthMm: profile.paperWidthMm,
      });
      if (qzResult.success) {
        return { success: true };
      }
      return { success: false, message: qzResult.message ?? 'QZ Tray không thể in hóa đơn.' };
    }
  } catch {
    // QZ Tray wasn't active, fallback to browser print
  }

  // Browser Print Fallback with thermal-receipt-print-root container
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return new Promise((resolve) => {
      let printRoot = document.getElementById('thermal-receipt-print-root');
      if (!printRoot) {
        printRoot = document.createElement('div');
        printRoot.id = 'thermal-receipt-print-root';
        document.body.appendChild(printRoot);
      }
      const profile = getReceiptPrintProfile(paperSize, printerConfig.printableDots);
      let printStyle = document.getElementById('thermal-receipt-page-style');
      if (!printStyle) {
        printStyle = document.createElement('style');
        printStyle.id = 'thermal-receipt-page-style';
        document.head.appendChild(printStyle);
      }
      printStyle.textContent = `@page { size: ${profile.paperWidthMm}mm auto; margin: 0; }
        @media print {
          #thermal-receipt-print-root { width: ${profile.paperWidthMm}mm !important; }
          #thermal-receipt-print-root .thermal-receipt-preview { width: ${profile.printableWidthMm}mm !important; max-width: ${profile.printableWidthMm}mm !important; box-sizing: border-box !important; }
          #thermal-receipt-print-root .thermal-receipt-copy-page:not(:last-child) { break-after: page; page-break-after: always; }
        }`;
      printRoot.innerHTML = Array.from(
        { length: copies },
        (_, index) =>
          `<section class="thermal-receipt-copy-page">${generateThermalReceiptHtml(options, { index: index + 1, total: copies })}</section>`,
      ).join('');

      // Preload all images (logo, VietQR) inside printRoot before opening print dialog
      const images = Array.from(printRoot.querySelectorAll('img'));
      const waitForImages =
        images.length > 0
          ? Promise.all(
              images.map(
                (img) =>
                  new Promise<void>((resolveImg) => {
                    if (img.complete && img.naturalHeight !== 0) {
                      resolveImg();
                      return;
                    }
                    img.addEventListener('load', () => resolveImg(), { once: true });
                    img.addEventListener('error', () => resolveImg(), { once: true });
                    setTimeout(() => resolveImg(), 2000); // 2s fallback
                  }),
              ),
            )
          : Promise.resolve();

      waitForImages.then(() => {
        setTimeout(() => {
          window.print();

          // Cleanup after print dialog completes
          setTimeout(() => {
            if (printRoot) {
              printRoot.innerHTML = '';
            }
            resolve({ success: true });
          }, 300);
        }, 100);
      });
    });
  }

  return { success: false, message: 'Không thể kích hoạt lệnh in.' };
}
