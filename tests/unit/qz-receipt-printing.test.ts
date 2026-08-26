import { beforeEach, describe, expect, it, vi } from 'vitest';

const qzMocks = vi.hoisted(() => ({
  create: vi.fn(() => ({ printer: 'mock' })),
  print: vi.fn(async (_config: unknown, _data: Array<Record<string, unknown>>) => undefined),
  connect: vi.fn(async () => undefined),
  isActive: vi.fn(() => true),
}));

vi.mock('qz-tray', () => ({
  default: {
    api: { getVersion: vi.fn(async () => '2.2.6') },
    configs: { create: qzMocks.create },
    print: qzMocks.print,
    printers: { find: vi.fn(async () => []) },
    security: {
      setCertificatePromise: vi.fn(),
      setSignaturePromise: vi.fn(),
    },
    websocket: {
      connect: qzMocks.connect,
      disconnect: vi.fn(async () => undefined),
      isActive: qzMocks.isActive,
    },
  },
}));

import { printEscPosReceipt } from '../../src/client/lib/qz-tray-service';
import {
  buildPrintDataFromQuote,
  formatSegmentDurationLabel,
  generateThermalReceiptHtml,
  printReceipt,
} from '../../src/client/lib/pos-receipt-printer';
import { buildEscPosReceipt } from '../../src/domain/receipt/receipt-generator';
import { defaultPrintTemplateConfig } from '../../src/contracts/store';
import type { StorePrintSettings } from '../../src/contracts/store';
import { buildOwnerPrintPreviewSample } from '../../src/client/features/owner/print-preview-sample';

const baseOptions = {
  paperSize: 'K80' as const,
  paperWidthMm: 80,
  autoCut: true,
  openCashDrawer: false,
  escPosData: ['REAL-ORDER-1', 'REAL-ORDER-2'],
  htmlData: ['<html>REAL-ORDER-1</html>', '<html>REAL-ORDER-2</html>'],
};

describe('QZ receipt dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qzMocks.isActive.mockReturnValue(true);
  });

  it('uses pixel HTML with all real copies for a system printer', async () => {
    const result = await printEscPosReceipt({
      ...baseOptions,
      connectionType: 'SYSTEM',
      printerName: 'Thermal Printer',
    });

    expect(result.success).toBe(true);
    expect(qzMocks.print).toHaveBeenCalledOnce();
    const [, data] = qzMocks.print.mock.calls[0]!;
    expect(data).toHaveLength(2);
    const firstJob = data[0]!;
    expect(firstJob).toMatchObject({ type: 'pixel', format: 'html' });
    expect(firstJob.data).toContain('REAL-ORDER-1');
  });

  it('automatically connects QZ Tray before dispatching a configured payment receipt', async () => {
    qzMocks.isActive.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    const result = await printReceipt({
      data: {
        receiptType: 'PAYMENT',
        orderCode: 'HD-AUTO-PRINT-001',
        orderType: 'TAKEAWAY',
        issuedAtMs: Date.now(),
        subtotal: 50_000,
        discountTotal: 0,
        total: 50_000,
        lines: [],
      },
      printSettings: {
        storeId: 'store-auto-print',
        updatedAt: Date.now(),
        maxReceiptReprintCount: 0,
        paymentCopyCount: 1,
        allowProvisionalPrint: true,
        provisionalCopyCount: 1,
        logoHorizontalLayout: false,
        bottomImageType: 'NONE',
        customAddressEnabled: false,
        footerLine1Bold: false,
        footerLine2Bold: true,
        printWifiEnabled: false,
        paperSize: 'K80',
        printersJson: JSON.stringify({
          connectionType: 'SYSTEM',
          printerName: 'Thermal Printer',
          paperSize: 'K80',
          autoCut: true,
          openCashDrawer: false,
        }),
      },
    });

    expect(result.success).toBe(true);
    expect(qzMocks.connect).toHaveBeenCalledOnce();
    expect(qzMocks.print).toHaveBeenCalledOnce();
  });

  it('renders the real receipt safely with copy and totals metadata', () => {
    const html = generateThermalReceiptHtml(
      {
        data: {
          receiptType: 'PROVISIONAL',
          orderCode: 'D-001',
          orderType: 'DINE_IN',
          tableName: 'Bàn <VIP>',
          issuedAtMs: Date.now(),
          subtotal: 75_000,
          discountTotal: 0,
          total: 75_000,
          lines: [
            {
              id: 'time',
              name: 'Tiền giờ',
              quantity: 1,
              unitPrice: 50_000,
              totalPrice: 50_000,
              isTime: true,
            },
            {
              id: 'drink',
              name: '<script>alert(1)</script>',
              quantity: 1,
              unitPrice: 25_000,
              totalPrice: 25_000,
            },
          ],
        },
        storeInfo: { storeName: 'Quán & Cafe' },
      },
      { index: 2, total: 3 },
    );

    expect(html).toContain('HÓA ĐƠN TẠM TÍNH');
    expect(html).toContain('CHƯA THANH TOÁN');
    expect(html).toContain('Liên 2/3');
    expect(html).toContain('Tổng tiền hàng &amp; dịch vụ');
    expect(html).toContain('Quán &amp; Cafe');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('prints checkout stop/resume time as one continuous pricing row', () => {
    const startedAtMs = Date.UTC(2026, 7, 26, 6, 2, 0);
    const data = buildPrintDataFromQuote({
      order: {
        id: 'order-continuous-time',
        displayCode: 'D-CONTINUOUS',
        orderType: 'DINE_IN',
        tableName: 'Líp 01',
        openedAt: startedAtMs,
      },
      items: [],
      time: {
        startedAtMs,
        endedAtMs: startedAtMs + 90_000,
        elapsedSeconds: 75,
        amountAfterRoundingVnd: 1_000,
        pricingConfig: { basePriceVnd: 40_000 },
        segments: [
          {
            name: 'Giá thường',
            type: 'BASE',
            startedAtMs,
            endedAtMs: startedAtMs + 30_000,
            elapsedSeconds: 30,
            priceVnd: 40_000,
            amountBeforeRoundingVnd: 333,
          },
          {
            name: 'Giá thường',
            type: 'BASE',
            startedAtMs: startedAtMs + 45_000,
            endedAtMs: startedAtMs + 90_000,
            elapsedSeconds: 45,
            priceVnd: 40_000,
            amountBeforeRoundingVnd: 500,
          },
        ],
      },
      totalVnd: 1_000,
    });

    expect(data.lines[0]?.timeSegments).toEqual([
      expect.objectContaining({
        startedAtMs,
        endedAtMs: startedAtMs + 90_000,
        elapsedSeconds: 75,
        amount: 833,
      }),
    ]);
    expect(formatSegmentDurationLabel(data.lines[0]!.timeSegments![0]!)).toBe('=1 phút');
    expect(
      formatSegmentDurationLabel({ name: 'Giá thường', type: 'BASE', elapsedSeconds: 27 }),
    ).toBe('=27 giây');
  });

  it('marks provisional receipts unpaid in HTML and ESC/POS, but not payment receipts', () => {
    const provisional = {
      data: {
        receiptType: 'PROVISIONAL' as const,
        orderCode: 'D-UNPAID-001',
        orderType: 'TAKEAWAY' as const,
        issuedAtMs: Date.now(),
        subtotal: 50_000,
        discountTotal: 0,
        total: 50_000,
        lines: [],
      },
    };
    const payment = {
      data: {
        ...provisional.data,
        receiptType: 'PAYMENT' as const,
        orderCode: 'HD-PAID-001',
      },
    };

    expect(generateThermalReceiptHtml(provisional)).toContain('CHƯA THANH TOÁN');
    expect(buildEscPosReceipt(provisional).escPosData).toContain('CHƯA THANH TOÁN');
    expect(generateThermalReceiptHtml(payment)).not.toContain('CHƯA THANH TOÁN');
    expect(buildEscPosReceipt(payment).escPosData).not.toContain('CHƯA THANH TOÁN');
  });

  it('generates VietQR only for the finalized payment amount, never for provisional totals', () => {
    const printSettings = {
      bottomImageType: 'VIETQR',
      bottomBankName: 'MBBANK',
      bottomBankAccountNumber: '0123456789',
      bottomBankAccountName: 'NGUYEN VAN A',
      templateConfigJson: JSON.stringify({
        PROVISIONAL: {
          ...defaultPrintTemplateConfig,
          showBottomImage: true,
        },
        PAYMENT: {
          ...defaultPrintTemplateConfig,
          showBottomImage: true,
        },
      }),
    } as StorePrintSettings;
    const baseData = {
      orderCode: 'D-QR-001',
      orderType: 'DINE_IN' as const,
      issuedAtMs: Date.now(),
      subtotal: 100_000,
      discountTotal: 0,
      total: 100_000,
      lines: [],
    };
    const provisional = generateThermalReceiptHtml({
      data: { ...baseData, receiptType: 'PROVISIONAL' },
      printSettings,
    });
    const payment = generateThermalReceiptHtml({
      data: { ...baseData, receiptType: 'PAYMENT', invoiceCode: 'HD-QR-001' },
      printSettings,
    });

    expect(provisional).not.toContain('img.vietqr.io');
    expect(payment).toContain('img.vietqr.io');
    expect(payment).toContain('amount=100000');
  });

  it('uses actual ESC/POS receipt data for a TCP printer', async () => {
    const result = await printEscPosReceipt({
      ...baseOptions,
      connectionType: 'NETWORK_TCP',
      networkIp: '192.168.1.150',
      networkPort: 9100,
    });

    expect(result.success).toBe(true);
    const [, data] = qzMocks.print.mock.calls[0]!;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      type: 'raw',
      format: 'command',
      data: 'REAL-ORDER-1',
    });
  });

  it('renders partial payment and remaining debt on payment receipts', () => {
    const options = {
      data: {
        receiptType: 'PAYMENT' as const,
        orderCode: 'HD-001',
        orderType: 'DINE_IN' as const,
        issuedAtMs: Date.now(),
        subtotal: 170_000,
        discountTotal: 0,
        total: 170_000,
        paidAmountVnd: 70_000,
        debtAmountVnd: 100_000,
        paymentAllocations: [
          { method: 'CASH' as const, amountVnd: 70_000 },
          { method: 'DEBT' as const, amountVnd: 100_000 },
        ],
        lines: [],
      },
    };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    expect(html).toContain('Tiền mặt đã thu');
    expect(html).toContain('Ghi công nợ');
    expect(html).toContain('100.000đ');
    expect(escPos).toContain('Tiền mặt đã thu');
    expect(escPos).toContain('Ghi công nợ');
  });

  it('prints manual item discount reasons separately from every applied promotion', () => {
    const options = {
      data: {
        receiptType: 'PAYMENT' as const,
        orderCode: 'HD-DISCOUNT-001',
        orderType: 'TAKEAWAY' as const,
        issuedAtMs: Date.now(),
        subtotal: 100_000,
        discountTotal: 35_000,
        promotionDiscount: 15_000,
        promotion: {
          name: 'Khai trương',
          type: 'FIXED_AMOUNT',
          value: 10_000,
          discountAmountVnd: 10_000,
        },
        promotions: [
          {
            name: 'Khai trương',
            type: 'FIXED_AMOUNT',
            value: 10_000,
            discountAmountVnd: 10_000,
          },
          {
            name: 'Khách VIP',
            type: 'FIXED_AMOUNT',
            value: 5_000,
            discountAmountVnd: 5_000,
          },
        ],
        total: 65_000,
        lines: [
          {
            id: 'item-discounted',
            name: 'Cà phê sữa',
            quantity: 1,
            unitPrice: 100_000,
            totalPrice: 80_000,
            discountAmount: 20_000,
            discountReason: 'Khách thân thiết',
          },
        ],
      },
    };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    for (const output of [html, escPos]) {
      expect(output).toContain('Giảm thủ công');
      expect(output).toContain('Khách thân thiết');
      expect(output).toContain('Khai trương');
      expect(output).toContain('Khách VIP');
    }
  });

  it('labels promotion gifts separately from manual item discounts', () => {
    const options = {
      data: {
        receiptType: 'PAYMENT' as const,
        orderCode: 'HD-GIFT-001',
        orderType: 'TAKEAWAY' as const,
        issuedAtMs: Date.now(),
        subtotal: 20_000,
        discountTotal: 0,
        total: 20_000,
        lines: [
          {
            id: 'promotion-gift',
            name: 'Trà đá tặng',
            quantity: 1,
            unitPrice: 8_000,
            totalPrice: 0,
            discountAmount: 8_000,
            discountReason: 'Quà tặng · Mua nước tặng trà đá',
            adjustmentSource: 'PROMOTION_GIFT' as const,
            promotionName: 'Mua nước tặng trà đá',
          },
        ],
      },
    };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    for (const output of [html, escPos]) {
      expect(output).toContain('Quà tặng khuyến mãi');
      expect(output).toContain('Mua nước tặng trà đá');
      expect(output).not.toContain('Giảm thủ công');
    }
  });

  it('prints a compact flat-price summary with the applied item list', () => {
    const options = {
      data: {
        receiptType: 'PAYMENT' as const,
        orderCode: 'HD-FLAT-001',
        orderType: 'TAKEAWAY' as const,
        issuedAtMs: Date.now(),
        subtotal: 20_000,
        discountTotal: 8_000,
        promotionDiscount: 8_000,
        total: 12_000,
        promotions: [
          {
            name: 'Đồng giá nước suối',
            type: 'FLAT_PRICE',
            value: 12_000,
            discountAmountVnd: 8_000,
            flatPriceItems: [
              {
                productName: 'Nước suối',
                variantName: 'Giá mặc định',
                quantityMilli: 1000,
                originalUnitPriceVnd: 20_000,
                flatUnitPriceVnd: 12_000,
                discountAmountVnd: 8_000,
              },
            ],
          },
        ],
        lines: [
          {
            id: 'water',
            name: 'Nước suối',
            quantity: 1,
            unitPrice: 20_000,
            totalPrice: 20_000,
          },
        ],
      },
    };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    for (const output of [html, escPos]) {
      expect(output).toContain('Đồng giá nước suối');
      expect(output).toContain('12.000');
      expect(output).toContain('Nước suối');
      expect(output).toContain('Giá mặc định');
      expect(output).toContain('SL: 1');
      expect(output).toContain('8.000');
      expect(output).not.toContain('Điều chỉnh');
      expect(output).not.toContain('→');
      expect(output).not.toContain('->');
      expect(output).not.toContain('× 1');
    }
  });

  it('keeps both Owner print previews synchronized with the flat-price sample', () => {
    const data = buildOwnerPrintPreviewSample('PAYMENT', Date.now());
    const options = { data };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    expect(data).toMatchObject({
      subtotal: 245_000,
      discountTotal: 32_000,
      promotionDiscount: 22_000,
      total: 213_000,
    });
    for (const output of [html, escPos]) {
      expect(output).toContain('Billiard');
      expect(output).toContain('=Giờ đầu');
      expect(output).toContain('=1 giờ');
      expect(output).toContain('Đồng giá trà đào');
      expect(output).toContain('Trà đào');
      expect(output).toContain('SL: 2');
      expect(output).toContain('9.000');
      expect(output).toContain('12.000');
    }
  });

  it('keeps payment and customer visibility switches identical in HTML and ESC/POS', () => {
    const hiddenTemplate = {
      ...defaultPrintTemplateConfig,
      showCustomerName: false,
      showCustomerPhone: false,
      showCustomerAddress: false,
      showPaymentMethod: false,
      showCashDetails: false,
    };
    const options = {
      data: {
        receiptType: 'PAYMENT' as const,
        orderCode: 'HD-SWITCH-001',
        orderType: 'TAKEAWAY' as const,
        customerName: 'Khách cần ẩn',
        guestPhone: '0900000000',
        guestAddress: 'Địa chỉ cần ẩn',
        issuedAtMs: Date.now(),
        subtotal: 50_000,
        discountTotal: 0,
        total: 50_000,
        paymentMethod: 'CASH' as const,
        cashReceived: 100_000,
        cashChange: 50_000,
        lines: [],
      },
      printSettings: {
        templateConfigJson: JSON.stringify({
          PROVISIONAL: hiddenTemplate,
          PAYMENT: hiddenTemplate,
        }),
      } as StorePrintSettings,
    };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    for (const output of [html, escPos]) {
      expect(output).not.toContain('Khách cần ẩn');
      expect(output).not.toContain('0900000000');
      expect(output).not.toContain('Địa chỉ cần ẩn');
      expect(output).not.toContain('Hình thức thanh toán');
      expect(output).not.toContain('Tiền khách đưa');
      expect(output).not.toContain('Tiền thừa');
    }
  });

  it('renders a debt collection receipt with balances before and after', () => {
    const options = {
      data: {
        receiptType: 'DEBT_PAYMENT' as const,
        orderCode: 'PTN-001',
        invoiceCode: 'PTN-001',
        orderType: 'TAKEAWAY' as const,
        customerName: 'Nguyễn Văn A',
        guestPhone: '0901234567',
        issuedAtMs: Date.now(),
        subtotal: 100_000,
        discountTotal: 0,
        total: 40_000,
        paymentMethod: 'CASH' as const,
        debtBeforeVnd: 100_000,
        debtPaymentVnd: 40_000,
        debtAfterVnd: 60_000,
        referenceCode: 'PTN-001',
        lines: [],
      },
    };
    const html = generateThermalReceiptHtml(options);
    const escPos = buildEscPosReceipt(options).escPosData;
    expect(html).toContain('PHIẾU THU CÔNG NỢ');
    expect(html).toContain('Dư nợ trước');
    expect(html).toContain('Dư nợ còn lại');
    expect(escPos).toContain('PHIẾU THU CÔNG NỢ');
    expect(escPos).toContain('60.000đ');
  });
});
