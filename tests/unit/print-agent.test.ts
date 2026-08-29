import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../../apps/print-agent/src/job-queue';
import { isDesktopPlatform } from '../../src/client/lib/print-bridge-service';
import { buildEscPosTextReceipt } from '../../src/printing/escpos/escpos-text-builder';

describe('Pro POS Print Agent Unit Tests', () => {
  it('detects desktop vs mobile platforms accurately', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
    expect(isDesktopPlatform()).toBe(true);

    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
    expect(isDesktopPlatform()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('processes print jobs sequentially per printer target to prevent byte interleaving', async () => {
    const queue = new JobQueue();
    const executionOrder: number[] = [];

    const makeTask = (id: number, delayMs: number) => async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      executionOrder.push(id);
    };

    // Enqueue 3 tasks on the same printer
    queue.enqueue('192.168.1.73:9100', makeTask(1, 30));
    queue.enqueue('192.168.1.73:9100', makeTask(2, 10));
    queue.enqueue('192.168.1.73:9100', makeTask(3, 5));

    // Wait for all to complete
    await new Promise((r) => setTimeout(r, 100));

    // Even though task 2 and 3 have smaller delays, they MUST execute in sequential FIFO order (1, 2, 3)
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('formats ESC/POS thermal text receipts with correct currency and structure', () => {
    const bytes = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'HD-999',
        invoiceCode: 'HD-999',
        orderType: 'DINE_IN',
        tableName: 'Bàn VIP 1',
        cashierName: 'Thu ngân quầy',
        subtotal: 100000,
        discountTotal: 10000,
        total: 90000,
        paymentMethod: 'CASH',
        cashReceived: 100000,
        cashChange: 10000,
        issuedAtMs: Date.now(),
        lines: [
          {
            id: '1',
            name: 'Nước ngọt Pepsi',
            quantity: 2,
            unitPrice: 20000,
            totalPrice: 40000,
          },
          {
            id: '2',
            name: 'Giờ chơi Bida',
            quantity: 1,
            unitPrice: 60000,
            totalPrice: 60000,
            isTime: true,
            timeStartedAtMs: Date.now() - 3600000,
            timeEndedAtMs: Date.now(),
          },
        ],
      },
      {
        paperSize: 'K80',
        storeName: 'PRO POS BILLIARDS CLUB',
        autoCut: true,
        openCashDrawer: true,
      },
    );

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);

    const text = new TextDecoder('utf-8').decode(bytes);
    expect(text).toContain('PRO POS BILLIARDS CLUB');
    expect(text).toContain('HÓA ĐƠN THANH TOÁN');
    expect(text).toContain('Bàn VIP 1');
    expect(text).toContain('Nước ngọt Pepsi');
    expect(text).toContain('90.000 đ');
    expect(text).toContain('Tiền mặt');
  });
});
