import { describe, expect, it } from 'vitest';

import type { StorePrintSettings } from '../../src/contracts/store';
import {
  buildVietQrPaymentPayload,
  createReceiptDocument,
} from '../../src/domain/receipt/receipt-document';
import {
  buildEscPosReceipt,
  type PosReceiptPrintData,
  type PosReceiptPrintOptions,
} from '../../src/domain/receipt/receipt-generator';
import { generateThermalReceiptHtml } from '../../src/client/lib/pos-receipt-printer';
import { imageDataToEscPosRaster } from '../../src/printing/escpos/escpos-raster';
import { buildEscPosTextReceipt } from '../../src/printing/escpos/escpos-text-builder';
import { receiptRasterCss } from '../../src/printing/receipt/receipt-template';

function containsByteSequence(bytes: Uint8Array, sequence: readonly number[]): boolean {
  return bytes.some((_, index) =>
    sequence.every((value, offset) => bytes[index + offset] === value),
  );
}

function paymentData(): PosReceiptPrintData {
  return {
    receiptType: 'PAYMENT',
    orderCode: 'ORDER-1',
    invoiceCode: 'INV-1',
    orderType: 'DINE_IN',
    tableName: 'Bàn VIP 1',
    areaName: 'Tầng 2',
    cashierName: 'Nguyễn Thu Ngân',
    customerName: 'Nguyễn Văn Khách',
    guestPhone: '0901234567',
    guestAddress: 'Đà Nẵng',
    note: 'Không đá',
    checkInTimeMs: 1_720_000_000_000,
    issuedAtMs: 1_720_003_600_000,
    subtotal: 120_000,
    discountTotal: 20_000,
    promotionDiscount: 10_000,
    promotions: [{ name: 'Khai trương', type: 'PERCENT', value: 10, discountAmountVnd: 10_000 }],
    total: 100_000,
    paymentMethod: 'CASH',
    cashReceived: 200_000,
    cashChange: 100_000,
    lines: [
      {
        id: 'time',
        name: 'Tiền giờ',
        quantity: 1,
        unitPrice: 60_000,
        totalPrice: 60_000,
        isTime: true,
        timeStartedAtMs: 1_720_000_000_000,
        timeEndedAtMs: 1_720_003_600_000,
        timeElapsedSeconds: 3600,
        timeSegments: [
          {
            name: 'Giờ thường',
            startedAtMs: 1_720_000_000_000,
            endedAtMs: 1_720_003_600_000,
            elapsedSeconds: 3600,
            priceVnd: 60_000,
            amount: 60_000,
          },
        ],
      },
      {
        id: 'item',
        name: 'Nước suối',
        quantity: 2,
        unitPrice: 30_000,
        totalPrice: 60_000,
        note: 'Lạnh',
        discountAmount: 10_000,
        discountReason: 'Khách thân thiết',
      },
      { id: 'free', name: 'Khăn lạnh', quantity: 1, unitPrice: 0, totalPrice: 0 },
    ],
  };
}

function printSettings(overrides: Partial<StorePrintSettings> = {}): StorePrintSettings {
  return {
    storeId: 'STORE-1',
    maxReceiptReprintCount: 0,
    paymentCopyCount: 1,
    allowProvisionalPrint: true,
    provisionalCopyCount: 1,
    logoHorizontalLayout: false,
    logoMediaId: null,
    bottomImageDescription: null,
    bottomImageType: 'NONE',
    bottomImageMediaId: null,
    bottomBankName: null,
    bottomBankAccountNumber: null,
    bottomBankAccountName: null,
    customAddressEnabled: false,
    customAddress: null,
    footerLine1: null,
    footerLine1Bold: false,
    footerLine2: null,
    footerLine2Bold: false,
    printWifiEnabled: false,
    wifiName: null,
    wifiPassword: null,
    paperSize: 'K80',
    printersJson: null,
    templateConfigJson: null,
    updatedAt: 1,
    ...overrides,
  };
}

function options(settings: StorePrintSettings): PosReceiptPrintOptions {
  return {
    data: paymentData(),
    printSettings: settings,
    storeInfo: { storeName: 'ĐẠI BILLIARDS', address: 'Đà Nẵng', phone: '02361234567' },
  };
}

describe('canonical receipt document', () => {
  it('uses receipt-oriented fonts for raster preview and both ESC/POS renderers', () => {
    const settings = printSettings();
    const currentBytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: settings,
      storeInfo: options(settings).storeInfo,
      vietnameseMode: 'UNACCENTED',
    });
    const legacyBytes = new TextEncoder().encode(buildEscPosReceipt(options(settings)).escPosData);

    expect(Array.from(currentBytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x4d, 0x00]);
    expect(Array.from(legacyBytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x4d, 0x00]);
    expect(receiptRasterCss(576)).toContain('"Courier New"');
    expect(receiptRasterCss(576)).toContain('monospace');
  });

  it('omits the unpaid banner from provisional preview and print output', () => {
    const settings = printSettings();
    const provisionalOptions: PosReceiptPrintOptions = {
      ...options(settings),
      data: { ...paymentData(), receiptType: 'PROVISIONAL' },
    };
    const html = generateThermalReceiptHtml(provisionalOptions);
    const escPosText = new TextDecoder().decode(
      buildEscPosTextReceipt(provisionalOptions.data, {
        printSettings: settings,
        storeInfo: provisionalOptions.storeInfo,
        vietnameseMode: 'UNACCENTED',
      }),
    );
    const legacyEscPosText = buildEscPosReceipt(provisionalOptions).escPosData;

    expect(html).toContain('HÓA ĐƠN TẠM TÍNH');
    expect(escPosText).toContain('HOA DON TAM TINH');
    expect(legacyEscPosText).toContain('HÓA ĐƠN TẠM TÍNH');
    expect(`${html}${escPosText}${legacyEscPosText}`).not.toMatch(
      /CHƯA THANH TOÁN|CHUA THANH TOAN/u,
    );
  });

  it('shows the selected price name only when a product has multiple price variants', () => {
    const settings = printSettings();
    const data: PosReceiptPrintData = {
      ...paymentData(),
      lines: [
        {
          id: 'single-price',
          name: 'Nước suối',
          priceName: 'Giá chuẩn',
          priceVariantCount: 1,
          quantity: 1,
          unitPrice: 10_000,
          totalPrice: 10_000,
        },
        {
          id: 'multi-price',
          name: 'Sting',
          priceName: 'Sting vàng',
          priceVariantCount: 2,
          quantity: 1,
          unitPrice: 12_000,
          totalPrice: 12_000,
        },
      ],
    };
    const receiptOptions = { ...options(settings), data };
    const html = generateThermalReceiptHtml(receiptOptions);
    const escPosText = new TextDecoder().decode(
      buildEscPosTextReceipt(data, {
        printSettings: settings,
        storeInfo: receiptOptions.storeInfo,
        vietnameseMode: 'UNACCENTED',
      }),
    );
    const legacyEscPosText = buildEscPosReceipt(receiptOptions).escPosData;

    expect(html).toContain('Sting (Sting vàng)');
    expect(escPosText).toContain('Sting (Sting');
    expect(escPosText).toContain('\nvang)');
    expect(legacyEscPosText).toContain('Sting (Sting vàng)');
    expect(html).not.toContain('Nước suối (Giá chuẩn)');
    expect(escPosText).not.toContain('Nuoc suoi (Gia chuan)');
    expect(legacyEscPosText).not.toContain('Nước suối (Giá chuẩn)');
  });

  it('resolves Owner visibility rules once for preview and ESC/POS', () => {
    const settings = printSettings({
      templateConfigJson: JSON.stringify({
        PAYMENT: {
          showCashierName: false,
          showCustomerPhone: false,
          showOrderNote: false,
          showItemDiscounts: false,
          showHourlyDetail: false,
          showPromotionsList: false,
          showBottomImage: false,
          hideZeroPriceItems: true,
        },
      }),
    });
    const document = createReceiptDocument(options(settings));
    expect(document.data.cashierName).toBeNull();
    expect(document.data.guestPhone).toBeNull();
    expect(document.data.note).toBeNull();
    expect(document.data.promotions).toEqual([]);
    expect(document.data.lines).toHaveLength(2);
    expect(document.data.lines.find((line) => line.id === 'item')).toMatchObject({
      note: 'Lạnh',
      discountAmount: 0,
      discountReason: null,
    });
    expect(document.data.lines.find((line) => line.id === 'time')?.timeSegments).toBeUndefined();
    expect(document.media.bottomImageUrl).toBeNull();

    const html = generateThermalReceiptHtml(options(settings));
    const text = new TextDecoder().decode(
      buildEscPosTextReceipt(paymentData(), {
        printSettings: settings,
        storeInfo: options(settings).storeInfo,
        vietnameseMode: 'UNACCENTED',
      }),
    );
    for (const hiddenValue of [
      '0901234567',
      'Nguyễn Thu Ngân',
      'Không đá',
      'Khách thân thiết',
      'Khai trương',
    ]) {
      expect(html).not.toContain(hiddenValue);
      expect(text).not.toContain(hiddenValue.normalize('NFD').replace(/[\u0300-\u036f]/gu, ''));
    }
  });

  it('never injects system branding into a production receipt', () => {
    const html = generateThermalReceiptHtml(options(printSettings()));
    const text = new TextDecoder().decode(
      buildEscPosTextReceipt(paymentData(), {
        printSettings: printSettings(),
        storeName: 'ĐẠI BILLIARDS',
        vietnameseMode: 'UNACCENTED',
      }),
    );
    expect(html).toContain('ĐẠI BILLIARDS');
    expect(text).toContain('DAI BILLIARDS');
    expect(`${html}${text}`).not.toContain('PRO POS');
    expect(`${html}${text}`).not.toContain('Pro POS - Hân hạnh phục vụ');
  });

  it('prints logo and store information in the same horizontal ESC/POS header', () => {
    const logoPixels = Uint8ClampedArray.from({ length: 48 * 48 * 4 }, (_, index) =>
      index % 4 === 3 ? 255 : 0,
    );
    const logoRasterBytes = imageDataToEscPosRaster(
      { width: 48, height: 48, data: logoPixels },
      576,
    );
    const bytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: printSettings({ logoHorizontalLayout: true }),
      storeInfo: {
        storeName: 'ĐẠI BILLIARDS',
        address: '57 610B Hà Tây An, Gò Nổi, Đà Nẵng',
        phone: '0905486466',
      },
      vietnameseMode: 'UNACCENTED',
      logoRasterBytes,
    });
    const text = new TextDecoder().decode(bytes);

    expect(containsByteSequence(bytes, [0x1b, 0x2a, 33])).toBe(true);
    expect(containsByteSequence(bytes, [0x1d, 0x76, 0x30, 0x00])).toBe(false);
    expect(text).toContain('DAI BILLIARDS');
    expect(text).toContain('57 610B Ha Tay An');
    expect(text).toContain('SDT: 0905486466');

    const verticalBytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: printSettings({ logoHorizontalLayout: false }),
      storeName: 'ĐẠI BILLIARDS',
      vietnameseMode: 'UNACCENTED',
      logoRasterBytes,
    });
    expect(containsByteSequence(verticalBytes, [0x1b, 0x2a, 33])).toBe(false);
    expect(containsByteSequence(verticalBytes, [0x1d, 0x76, 0x30, 0x00])).toBe(true);
  });

  it('builds a fixed VietQR payload without amount or transfer content', () => {
    const payload = buildVietQrPaymentPayload({
      bankBin: '970422',
      accountNumber: '123456789',
    });
    expect(payload).toMatch(/^000201010211/u);
    expect(payload).toContain('A000000727');
    expect(payload).toContain('970422');
    expect(payload).toContain('123456789');
    expect(payload).not.toContain('http');
    expect(payload).not.toContain('100000');
    expect(payload).not.toContain('INV-1');
    expect(payload.slice(-8, -4)).toBe('6304');

    const document = createReceiptDocument(
      options(
        printSettings({
          bottomImageType: 'VIETQR',
          bottomBankName: '970422',
          bottomBankAccountNumber: '123456789',
          bottomBankAccountName: 'NGUYEN VAN A',
        }),
      ),
    );
    expect(document.media.bottomImageUrl).toContain('img.vietqr.io/image/970422-123456789');
    expect(document.media.bottomImageUrl).not.toContain('amount=');
    expect(document.media.bottomImageUrl).not.toContain('addInfo=');
    expect(document.media.vietQrPayload).toBe(payload);
    const anotherDocument = createReceiptDocument({
      ...options(
        printSettings({
          bottomImageType: 'VIETQR',
          bottomBankName: '970422',
          bottomBankAccountNumber: '123456789',
          bottomBankAccountName: 'NGUYEN VAN A',
        }),
      ),
      data: {
        ...paymentData(),
        orderCode: 'ORDER-OTHER',
        invoiceCode: 'INV-OTHER',
        total: 999_000,
      },
    });
    expect(anotherDocument.media.bottomImageUrl).toBe(document.media.bottomImageUrl);
    expect(anotherDocument.media.vietQrPayload).toBe(document.media.vietQrPayload);

    const escposText = new TextDecoder().decode(
      buildEscPosTextReceipt(paymentData(), {
        printSettings: printSettings({
          bottomImageType: 'VIETQR',
          bottomBankName: '970422',
          bottomBankAccountNumber: '123456789',
          bottomBankAccountName: 'NGUYEN VAN A',
        }),
        storeName: 'DAI BILLIARDS',
        vietnameseMode: 'UNACCENTED',
      }),
    );
    expect(escposText).toContain(payload);
    expect(escposText).not.toContain('https://img.vietqr.io/');
  });

  it('keeps footer weight and K80/K58 profiles explicit', () => {
    const settings = printSettings({
      footerLine1: 'Dòng đậm',
      footerLine1Bold: true,
      footerLine2: 'Dòng thường',
      footerLine2Bold: false,
      paperSize: 'K58',
      printersJson: JSON.stringify({ paperSize: 'K58', printableDots: 384 }),
    });
    const document = createReceiptDocument(options(settings));
    expect(document.footer).toEqual([
      { text: 'Dòng đậm', bold: true },
      { text: 'Dòng thường', bold: false },
    ]);
    expect(document.paperSize).toBe('K58');
    expect(document.profile.defaultPrintableDots).toBe(384);
    expect(document.profile.charsPerLineFontA).toBe(35);
    expect(
      createReceiptDocument(options(printSettings({ paperSize: 'K80' }))).profile
        .defaultPrintableDots,
    ).toBe(576);

    const bytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: settings,
      storeName: 'DAI BILLIARDS',
      vietnameseMode: 'UNACCENTED',
    });
    const footerSequence = new Uint8Array([
      0x1b,
      0x45,
      0x01,
      ...new TextEncoder().encode('Dong dam\n'),
      0x1b,
      0x45,
      0x00,
      ...new TextEncoder().encode('Dong thuong\n'),
    ]);
    const containsFooterSequence = bytes.some((_, index) =>
      footerSequence.every((value, offset) => bytes[index + offset] === value),
    );
    expect(containsFooterSequence).toBe(true);
  });

  it('keeps each hourly date and duration on one compact line in print and preview', () => {
    const settings = printSettings({
      templateConfigJson: JSON.stringify({
        PAYMENT: {
          showHourlyDetail: true,
          hourlyDetailMode: 'FULL_TIMELOG',
          showHourlyUnitPrice: true,
        },
      }),
    });
    const html = generateThermalReceiptHtml(options(settings));
    expect(html).toMatch(
      /thermal-receipt-time-meta[\s\S]*?<span>\d{2}\/\d{2}\/\d{4}<\/span>[\s\S]*?<span>=1 giờ<\/span>/u,
    );

    const text = new TextDecoder().decode(
      buildEscPosTextReceipt(paymentData(), {
        printSettings: settings,
        storeName: 'DAI BILLIARDS',
        vietnameseMode: 'UNACCENTED',
      }),
    );
    expect(text).toMatch(/\d{2}\/\d{2}\/\d{4}  =1 gio/u);
    expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}\n\s*=1 gio/u);
  });

  it('applies Owner item font size setting to both ESC/POS commands and HTML preview', () => {
    const smallSettings = printSettings({
      templateConfigJson: JSON.stringify({
        PAYMENT: { itemFontSize: 'SMALL' },
      }),
    });
    const smallBytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: smallSettings,
      storeName: 'DAI BILLIARDS',
      vietnameseMode: 'UNACCENTED',
    });
    // ESC_POS.selectFontB = [0x1b, 0x4d, 0x01]
    expect(containsByteSequence(smallBytes, [0x1b, 0x4d, 0x01])).toBe(true);
    // Reset back to Font A at the end of items = [0x1b, 0x21, 0x00, 0x1b, 0x4d, 0x00]
    expect(containsByteSequence(smallBytes, [0x1b, 0x21, 0x00, 0x1b, 0x4d, 0x00])).toBe(true);

    const smallHtml = generateThermalReceiptHtml(options(smallSettings));
    expect(smallHtml).toContain('thermal-receipt-items--small');

    const largeSettings = printSettings({
      templateConfigJson: JSON.stringify({
        PAYMENT: { itemFontSize: 'LARGE' },
      }),
    });
    const largeBytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: largeSettings,
      storeName: 'DAI BILLIARDS',
      vietnameseMode: 'UNACCENTED',
    });
    // ESC_POS.doubleHeightOn = [0x1b, 0x21, 0x10]
    expect(containsByteSequence(largeBytes, [0x1b, 0x21, 0x10])).toBe(true);
    expect(containsByteSequence(largeBytes, [0x1b, 0x21, 0x00, 0x1b, 0x4d, 0x00])).toBe(true);

    const largeHtml = generateThermalReceiptHtml(options(largeSettings));
    expect(largeHtml).toContain('thermal-receipt-items--large');
  });

  it('renders goods table borders in ESC/POS text and HTML preview when enabled', () => {
    const borderedSettings = printSettings({
      templateConfigJson: JSON.stringify({
        PAYMENT: { showItemTableBorder: true },
      }),
    });
    const borderedBytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: borderedSettings,
      storeName: 'DAI BILLIARDS',
      vietnameseMode: 'UNACCENTED',
    });
    const borderedText = new TextDecoder().decode(borderedBytes);
    expect(borderedText).toMatch(/\+[-+]+\+/u);
    expect(borderedText).toMatch(/\|.*Mat hang.*\|/u);
    expect(borderedText).toMatch(/\|.*Nuoc suoi.*\|/u);

    const borderedHtml = generateThermalReceiptHtml(options(borderedSettings));
    expect(borderedHtml).toContain('thermal-receipt-items--bordered');

    const unborderedSettings = printSettings({
      templateConfigJson: JSON.stringify({
        PAYMENT: { showItemTableBorder: false },
      }),
    });
    const unborderedBytes = buildEscPosTextReceipt(paymentData(), {
      printSettings: unborderedSettings,
      storeName: 'DAI BILLIARDS',
      vietnameseMode: 'UNACCENTED',
    });
    const unborderedText = new TextDecoder().decode(unborderedBytes);
    expect(unborderedText).not.toMatch(/\+[-+]+\+/u);
    expect(unborderedText).not.toMatch(/\|.*Mat hang.*\|/u);

    const unborderedHtml = generateThermalReceiptHtml(options(unborderedSettings));
    expect(unborderedHtml).not.toContain('thermal-receipt-items--bordered');
  });
});
