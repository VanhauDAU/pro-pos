import {
  type PaperSize,
  getReceiptPrintProfile,
  parsePrintTemplateConfigs,
  parsePrinterDeviceConfig,
} from '@contracts/store';
import { type PosReceiptPrintOptions } from '@domain/receipt/receipt-generator';
import { checkQzTrayStatus, printTestReceipt } from './qz-tray-service';

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

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? `${m}p` : ''}`;
  return `${m} phút`;
}

/**
 * Generates an exact HTML document string matching the store's thermal receipt preview.
 */
export function generateThermalReceiptHtml(options: PosReceiptPrintOptions): string {
  const { data, printSettings, storeInfo } = options;
  const templateConfigs = parsePrintTemplateConfigs(printSettings?.templateConfigJson);
  const template =
    data.receiptType === 'PROVISIONAL' ? templateConfigs.PROVISIONAL : templateConfigs.PAYMENT;

  const printerConfig = parsePrinterDeviceConfig(printSettings?.printersJson);
  const paperSize: PaperSize = printSettings?.paperSize || printerConfig.paperSize || 'K80';
  const isK58 = paperSize === 'K58';
  const profile = getReceiptPrintProfile(paperSize, printerConfig.printableDots);

  const storeName = storeInfo?.storeName || 'PRO POS';
  const storeAddress = printSettings?.customAddressEnabled
    ? printSettings.customAddress
    : storeInfo?.address;
  const storePhone = storeInfo?.phone;

  // Resolve Logo URL
  let logoUrl: string | null = null;
  if (template.showLogo) {
    if (printSettings?.logoMediaId) {
      logoUrl = `/api/v1/media/${printSettings.logoMediaId}`;
    } else {
      logoUrl = '/logo-black.svg';
    }
  }

  // Resolve Bottom Image / VietQR URL
  const code = data.invoiceCode || data.orderCode;
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
        bottomImageUrl = `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-qr_only.png?amount=${data.total}&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(accountName)}`;
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
          <img src="${logoUrl}" alt="Logo" style="width: ${isK58 ? '32px' : '44px'}; height: ${isK58 ? '32px' : '44px'}; object-fit: contain;" />
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
                <img src="${logoUrl}" alt="Logo" style="max-width: ${isK58 ? '70px' : '90px'}; max-height: 45px; object-fit: contain; margin: 0 auto 4px; display: block;" />
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
  const title = data.receiptType === 'PROVISIONAL' ? 'PHIẾU TẠM TÍNH' : 'HÓA ĐƠN THANH TOÁN';

  html += `
    <div class="thermal-receipt-title">${title}</div>
    <div class="thermal-receipt-code-line">
      <span>Số: ${code}</span>
      <span>${formatDateTime(data.issuedAtMs)}</span>
    </div>
    <div class="thermal-receipt-divider-dash"></div>
  `;

  // 3. Meta Information
  html += `<div class="thermal-receipt-meta">`;
  if (template.showTableAreaName && (data.tableName || data.areaName)) {
    const tableArea = [data.tableName, data.areaName].filter(Boolean).join(' · ');
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
        <span class="thermal-receipt-value">${data.cashierName}</span>
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
          <span class="thermal-receipt-value">${data.customerName}</span>
        </div>
      `;
    }
    if (template.showCustomerPhone && data.guestPhone) {
      html += `
        <div class="thermal-receipt-row">
          <span class="thermal-receipt-label">Điện thoại</span>
          <span class="thermal-receipt-value">${data.guestPhone}</span>
        </div>
      `;
    }
    if (template.showCustomerAddress && data.guestAddress) {
      html += `
        <div class="thermal-receipt-row">
          <span class="thermal-receipt-label">Địa chỉ</span>
          <span class="thermal-receipt-value">${data.guestAddress}</span>
        </div>
      `;
    }
    if (template.showOrderNote && data.note) {
      html += `
        <div class="thermal-receipt-row" style="font-style: italic; margin-top: 2px;">
          <span>*Ghi chú:</span>
          <span>${data.note}</span>
        </div>
      `;
    }
  }

  html += `</div><div class="thermal-receipt-divider-dash"></div>`;

  // Filter time lines vs product lines
  const timeLines = data.lines.filter((l) => l.isTime);
  const productLines = data.lines.filter((l) => !l.isTime);

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
                • ${tSeg.tableName}: ${formatClock(tSeg.startedAtMs)}–${tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hiện tại'} (${formatDuration(tSeg.elapsedSeconds)})${tSeg.hourlyPrice ? ` @ ${formatVnd(tSeg.hourlyPrice)}/h` : ''} = ${formatVnd(tSeg.amount)}
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
              <span style="flex: 1; font-weight: 600;">${prefix}${line.name}</span>
              ${!isK58 && template.showHourlyUnitPrice ? `<span style="width: 65px; text-align: right;">${formatVnd(line.unitPrice)}${template.showHourlyUnitDuration ? '/1h' : ''}</span>` : ''}
              <span style="width: ${isK58 ? '48px' : '65px'}; text-align: right; font-weight: 600;">${formatVnd(line.totalPrice)}</span>
            </div>
            ${isK58 && template.showHourlyUnitPrice ? `<div class="thermal-receipt-item-sub">Đ.Giá: ${formatVnd(line.unitPrice)}${template.showHourlyUnitDuration ? '/1h' : ''}</div>` : ''}
            ${
              template.showHourlyDetail
                ? template.hourlyDetailMode === 'FULL_TIMELOG'
                  ? `<div class="thermal-receipt-item-sub">
                      ${line.timeStartedAtMs ? `<div>${template.showHourlyTimeWithSeconds ? formatDateTime(line.timeStartedAtMs) : formatDateTime(line.timeStartedAtMs).slice(0, 16)} - ${line.timeEndedAtMs ? (template.showHourlyTimeWithSeconds ? formatDateTime(line.timeEndedAtMs) : formatDateTime(line.timeEndedAtMs).slice(0, 16)) : 'Hiện tại'}</div>` : ''}
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
            <span style="flex: 1; font-weight: 600;">${prefix}${line.name}${template.showItemPriceName ? ' (Giá chuẩn)' : ''}</span>
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
              ? `<div class="thermal-receipt-item-sub" style="font-style: italic;">* G/chú: ${line.note}</div>`
              : ''
          }
        </div>
      `;
    }

    html += `</div><div class="thermal-receipt-divider-dash"></div>`;
  }

  // 5. Summary & Totals
  html += `<div class="thermal-receipt-summary">`;
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
        <img src="${bottomImageUrl}" alt="QR Bill" class="thermal-receipt-bottom-qr-img" style="width: ${profile.maxQrSizePx}px; height: ${profile.maxQrSizePx}px; object-fit: contain; margin: 0 auto; display: block;" />
        ${printSettings?.bottomImageDescription ? `<div class="thermal-receipt-qr-desc" style="font-size: 9px; margin-top: 2px;">${printSettings.bottomImageDescription}</div>` : ''}
      </div>
    `;
  }

  // 8. Wi-Fi
  if (printSettings?.printWifiEnabled && (printSettings.wifiName || printSettings.wifiPassword)) {
    html += `
      <div class="thermal-receipt-wifi">
        <span>Wi-Fi: <strong>${printSettings.wifiName || 'Cửa hàng'}</strong></span>
        ${printSettings.wifiPassword ? `<span>Pass: <strong>${printSettings.wifiPassword}</strong></span>` : ''}
      </div>
    `;
  }

  // 9. Footer text
  if (printSettings?.footerLine1) {
    html += `
      <div class="thermal-receipt-footer-text" style="${printSettings.footerLine1Bold ? 'font-weight: 700;' : ''}">
        ${printSettings.footerLine1}
      </div>
    `;
  }
  if (printSettings?.footerLine2) {
    html += `
      <div class="thermal-receipt-footer-text" style="${printSettings.footerLine2Bold ? 'font-weight: 700;' : ''}">
        ${printSettings.footerLine2}
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

  // Check if QZ Tray is active
  try {
    const qzStatus = await checkQzTrayStatus();
    if (qzStatus.connected) {
      const qzResult = await printTestReceipt({
        connectionType: printerConfig.connectionType,
        printerName: printerConfig.printerName,
        networkIp: printerConfig.networkIp,
        networkPort: printerConfig.networkPort,
        paperSize,
        printableDots: printerConfig.printableDots,
        autoCut: printerConfig.autoCut,
        openCashDrawer: printerConfig.openCashDrawer && options.data.receiptType === 'PAYMENT',
        storeName: options.storeInfo?.storeName || 'PRO POS',
      });
      if (qzResult.success) {
        return { success: true };
      }
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

      printRoot.innerHTML = generateThermalReceiptHtml(options);

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
