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
import { generateThermalReceiptHtml } from '../../src/client/lib/pos-receipt-printer';
import { buildEscPosReceipt } from '../../src/domain/receipt/receipt-generator';

const baseOptions = {
  paperSize: 'K80' as const,
  paperWidthMm: 80,
  autoCut: true,
  openCashDrawer: false,
  escPosData: ['REAL-ORDER-1', 'REAL-ORDER-2'],
  htmlData: ['<html>REAL-ORDER-1</html>', '<html>REAL-ORDER-2</html>'],
};

describe('QZ receipt dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(html).toContain('Liên 2/3');
    expect(html).toContain('Tổng tiền hàng &amp; dịch vụ');
    expect(html).toContain('Quán &amp; Cafe');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
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
