export function receiptRasterCss(printableDots: number) {
  const safeContentDots = Math.max(1, printableDots - 16);
  const compact = printableDots <= 432;
  const bodyFontDots = compact ? 19 : 23;
  const metaFontDots = compact ? 19 : 22;
  const subFontDots = compact ? 17 : 20;
  const footerFontDots = compact ? 18 : 21;
  const quantityColumnDots = compact ? 42 : 54;
  const unitPriceColumnDots = compact ? 82 : 108;
  const totalColumnDots = compact ? 92 : 124;
  const smallItemFontDots = compact ? 17 : 21;
  const largeItemFontDots = compact ? 21 : 25;
  const root = '.receipt-raster-root';
  return `
    ${root}, ${root} * { box-sizing: border-box; }
    ${root} { width: ${printableDots}px; margin: 0; padding: 0 8px; overflow: hidden; background: #fff; color: #000; font-family: Arial, "Helvetica Neue", sans-serif; }
    ${root}, ${root} * { color: #000 !important; opacity: 1 !important; }
    ${root} .thermal-receipt-preview {
      width: ${safeContentDots}px; max-width: ${safeContentDots}px; margin: 0; padding: 12px 0 0;
      overflow: hidden; border: 0; border-radius: 0; box-shadow: none; background: #fff;
      font-family: Arial, "Helvetica Neue", sans-serif; font-size: ${bodyFontDots}px !important; line-height: 1.3; color: #000;
    }
    ${root} .thermal-receipt-inner, ${root} .thermal-receipt-inner * { min-width: 0; max-width: 100%; }
    ${root} .thermal-receipt-inner { display: flex; flex-direction: column; gap: 4px; }
    ${root} .thermal-receipt-header-vertical, ${root} .thermal-receipt-title, ${root} .thermal-receipt-copy-count,
    ${root} .thermal-receipt-star-divider, ${root} .thermal-receipt-footer-text, ${root} .thermal-receipt-wifi { text-align: center; }
    ${root} .thermal-receipt-header-horizontal { display: flex; align-items: center; gap: 12px; }
    ${root} .thermal-receipt-store-info { flex: 1; min-width: 0; }
    ${root} .thermal-receipt-store-name { font-size: 27px; font-weight: 800; text-transform: uppercase; text-align: center; }
    ${root} .thermal-receipt-store-address, ${root} .thermal-receipt-store-phone { font-size: ${compact ? 18 : 20}px !important; font-weight: 500; text-align: center; }
    ${root} .thermal-receipt-title { font-size: 29px; font-weight: 800; margin-top: 8px; }
    ${root} .thermal-receipt-unpaid { margin: 5px 0; border: 2px solid #000; padding: 5px; text-align: center; font-size: 24px; font-weight: 800; }
    ${root} .thermal-receipt-copy-count { font-size: 20px; }
    ${root} .thermal-receipt-divider-dash { border-bottom: 2px dashed #000; margin: 8px 0; }
    ${root} .thermal-receipt-meta { display: flex; flex-direction: column; gap: 5px; font-size: ${metaFontDots}px !important; font-weight: 500; line-height: 1.3; }
    ${root} .thermal-receipt-summary { display: flex; flex-direction: column; gap: 5px; font-size: ${bodyFontDots}px !important; font-weight: 600; line-height: 1.3; }
    ${root} .thermal-receipt-row, ${root} .thermal-receipt-item-main,
    ${root} .thermal-receipt-grand-total { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    ${root} .thermal-receipt-row { font-size: ${metaFontDots}px !important; line-height: 1.3; }
    ${root} .thermal-receipt-label { font-weight: 600 !important; }
    ${root} .thermal-receipt-value { font-weight: 600; }
    ${root} .thermal-receipt-row > :first-child { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    ${root} .thermal-receipt-row > :last-child, ${root} .thermal-receipt-item-main > :last-child:not(:first-child) { flex: 0 0 auto; text-align: right; white-space: nowrap; }
    ${root} .thermal-receipt-table-header { display: flex !important; align-items: flex-start; gap: 10px; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 2px dashed #000; font-size: ${subFontDots}px !important; font-weight: 700; line-height: 1.2; }
    ${root} .thermal-receipt-items { font-size: ${bodyFontDots}px !important; line-height: 1.3; }
    ${root} .thermal-receipt-items--small { font-size: ${smallItemFontDots}px !important; }
    ${root} .thermal-receipt-items--medium { font-size: ${bodyFontDots}px !important; }
    ${root} .thermal-receipt-items--large { font-size: ${largeItemFontDots}px !important; }
    ${root} .thermal-receipt-item-row { margin-bottom: 10px; font-size: inherit !important; font-weight: 500; line-height: 1.3; }
    ${root} .thermal-receipt-item-main { flex-wrap: nowrap; align-items: flex-start; font-size: inherit !important; line-height: 1.3; }
    ${root} .thermal-receipt-time-segment { font-size: inherit !important; font-weight: 500; line-height: 1.3; }
    ${root} .thermal-receipt-time-row { display: grid !important; align-items: baseline; column-gap: 10px; }
    ${root} .thermal-receipt-items--time.thermal-receipt-items--with-unit-price .thermal-receipt-table-header,
    ${root} .thermal-receipt-items--time.thermal-receipt-items--with-unit-price .thermal-receipt-time-row { display: grid !important; grid-template-columns: minmax(0, 1fr) ${unitPriceColumnDots}px ${totalColumnDots}px; column-gap: 10px; }
    ${root} .thermal-receipt-items--time:not(.thermal-receipt-items--with-unit-price) .thermal-receipt-table-header,
    ${root} .thermal-receipt-items--time:not(.thermal-receipt-items--with-unit-price) .thermal-receipt-time-row { display: grid !important; grid-template-columns: minmax(0, 1fr) ${totalColumnDots}px; column-gap: 10px; }
    ${root} .thermal-receipt-col-name { flex: 1 1 0 !important; width: auto !important; min-width: 0; text-align: left !important; white-space: normal !important; overflow-wrap: anywhere; }
    ${root} .thermal-receipt-col-quantity { flex: 0 0 ${quantityColumnDots}px !important; width: ${quantityColumnDots}px !important; text-align: center !important; }
    ${root} .thermal-receipt-col-unit-price { flex: 0 0 ${unitPriceColumnDots}px !important; width: ${unitPriceColumnDots}px !important; text-align: right !important; white-space: nowrap; }
    ${root} .thermal-receipt-col-total { flex: 0 0 ${totalColumnDots}px !important; width: ${totalColumnDots}px !important; text-align: right !important; white-space: nowrap; }
    ${root} .thermal-receipt-item-sub { font-size: ${subFontDots}px !important; font-weight: 500; padding-left: 5px; line-height: 1.3; overflow-wrap: anywhere; }
    ${root} .thermal-receipt-items--bordered { border: 2px solid #000; padding: 6px; }
    ${root} .thermal-receipt-grand-total { font-size: 27px; font-weight: 800; }
    ${root} .thermal-receipt-grand-total-amount { font-size: 29px; font-weight: 800; white-space: nowrap; }
    ${root} .thermal-receipt-row > :last-child, ${root} .thermal-receipt-grand-total-amount { font-variant-numeric: tabular-nums; }
    ${root} .thermal-receipt-star-divider { margin: 6px 0; font-size: ${subFontDots}px !important; }
    ${root} .thermal-receipt-bottom-qr-img { display: block; width: ${compact ? 160 : 200}px !important; height: ${compact ? 160 : 200}px !important; margin: 0 auto; object-fit: contain; image-rendering: pixelated; }
    ${root} .thermal-receipt-qr-desc { font-size: ${footerFontDots}px !important; font-weight: 600; }
    ${root} .thermal-receipt-wifi { margin: 8px 0; padding: 5px; font-size: ${footerFontDots}px !important; font-weight: 600; line-height: 1.3; background: #fff !important; }
    ${root} .thermal-receipt-footer-text { margin: 4px 0; font-size: ${footerFontDots}px !important; font-weight: 600; line-height: 1.3; }
    ${root} img { object-fit: contain; }
  `;
}

const testQrSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="126" height="126" aria-label="QR kiểm tra">
    <rect width="21" height="21" fill="white"/>
    <path fill="black" d="M1 1h7v7H1zm2 2v3h3V3zM13 1h7v7h-7zm2 2v3h3V3zM1 13h7v7H1zm2 2v3h3v-3zM10 10h2v2h-2zm3 0h2v2h-2zm3 0h4v2h-4zm-6 3h2v4h-2zm3 1h3v2h-3zm4-1h3v3h-3zm-4 4h2v3h-2zm3 0h4v2h-4zm-6 2h2v1h-2z"/>
  </svg>`;

export function createTestReceiptHtml(storeName = 'PRO POS') {
  return `<div class="thermal-receipt-preview thermal-receipt-preview--k80"><div class="thermal-receipt-inner">
    <div class="thermal-receipt-store-name">${escapeHtml(storeName)}</div>
    <div style="font-size:22px;font-weight:700;text-align:center">BILLIARDS</div>
    <div class="thermal-receipt-title">IN THỬ MÁY IN</div>
    <div style="text-align:center;font-weight:700">HÓA ĐƠN · Tiếng Việt</div>
    <div class="thermal-receipt-divider-dash"></div>
    <div>Khu vực: Khu vực 1</div><div>Bàn: Bàn 01</div><div>Thu ngân: Văn Hậu</div><div>Khách: Nguyễn Ánh</div>
    <div class="thermal-receipt-divider-dash"></div>
    ${testItem('Coca Cola 330ml', '1 x 15.000', '15.000')}
    ${testItem('Bia Tiger', '1 x 22.000', '22.000')}
    ${testItem('Trái cây theo kg – tên món rất dài để kiểm tra tự động xuống dòng', '1 x 80.000', '80.000')}
    <div class="thermal-receipt-divider-dash"></div>
    ${testMoney('Tiền hàng', '117.000')}${testMoney('Tiền giờ', '60.000')}${testMoney('Giảm giá', '0')}
    <div class="thermal-receipt-grand-total"><span>TỔNG CỘNG</span><span class="thermal-receipt-grand-total-amount">177.000</span></div>
    <div class="thermal-receipt-divider-dash"></div>
    <div style="text-align:center">${testQrSvg}</div>
    <div class="thermal-receipt-footer-text"><strong>Cảm ơn quý khách!</strong><br/>Chúc quý khách có những giờ chơi vui vẻ.</div>
  </div></div>`;
}

export function createCalibrationReceiptHtml(printableDots: number) {
  return `<div class="thermal-receipt-preview"><div class="thermal-receipt-inner">
    <div class="thermal-receipt-title">HIỆU CHUẨN VÙNG IN</div>
    <div style="text-align:center">${printableDots} dots</div>
    <div style="border:3px solid #000;width:100%;height:80px;display:flex;align-items:center;justify-content:space-between">
      <strong>← MÉP TRÁI</strong><strong>MÉP PHẢI →</strong>
    </div>
    <div class="thermal-receipt-divider-dash"></div>
    ${testMoney('Tiền Việt Nam', '1.234.567')}
    <div>Tên mặt hàng dài phải tự xuống dòng và tuyệt đối không bị cắt ở cạnh phải.</div>
  </div></div>`;
}

function testItem(name: string, quantityAndPrice: string, total: string) {
  return `<div class="thermal-receipt-item-row"><div style="font-weight:700;overflow-wrap:anywhere">${name}</div><div class="thermal-receipt-item-main"><span>${quantityAndPrice}</span><span>${total}</span></div></div>`;
}

function testMoney(label: string, value: string) {
  return `<div class="thermal-receipt-row"><span>${label}:</span><span>${value}</span></div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
