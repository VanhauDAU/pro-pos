import { describe, expect, it } from 'vitest';

import type { StorePrintSettings } from '../../src/contracts/store';
import {
  buildVietQrPaymentPayload,
  createReceiptDocument,
} from '../../src/domain/receipt/receipt-document';
import type {
  PosReceiptPrintData,
  PosReceiptPrintOptions,
} from '../../src/domain/receipt/receipt-generator';
import { generateThermalReceiptHtml } from '../../src/client/lib/pos-receipt-printer';
import { buildEscPosTextReceipt } from '../../src/printing/escpos/escpos-text-builder';

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

  it('builds a payment EMV payload rather than a VietQR image URL', () => {
    const payload = buildVietQrPaymentPayload({
      bankBin: '970422',
      accountNumber: '123456789',
      amountVnd: 100_000,
      transferContent: 'INV-1',
    });
    expect(payload).toMatch(/^000201010212/u);
    expect(payload).toContain('A000000727');
    expect(payload).toContain('970422');
    expect(payload).toContain('123456789');
    expect(payload).not.toContain('http');
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
    expect(document.media.vietQrPayload).toBe(payload);

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
});
