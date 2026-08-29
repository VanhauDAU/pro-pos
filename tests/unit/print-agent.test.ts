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

  it('formats ESC/POS thermal text receipts with clean diacritics and correct alignment', () => {
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
    expect(text).toContain('HOA DON THANH TOAN');
    expect(text).toContain('Ban VIP 1');
    expect(text).toContain('Nuoc ngot Pepsi');
    expect(text).toContain('90.000 d');
    expect(text).toContain('Tien mat');
  });

  it('wraps long item names cleanly across lines without pushing quantity or total onto next line', () => {
    const bytes = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'HD-100',
        orderType: 'DINE_IN',
        tableName: 'Bàn 01',
        cashierName: 'Nguyễn Văn A',
        subtotal: 155000,
        discountTotal: 0,
        total: 155000,
        issuedAtMs: Date.now(),
        lines: [
          {
            id: '1',
            name: 'Trà sữa ô long (size L) kèm trân châu đen',
            quantity: 1,
            unitPrice: 65000,
            totalPrice: 65000,
          },
          {
            id: '2',
            name: 'Bia Tiger bạc lon 330ml',
            quantity: 2,
            unitPrice: 25000,
            totalPrice: 50000,
          },
        ],
      },
      {
        paperSize: 'K80',
        printSettings: {
          templateConfigJson: JSON.stringify({
            PAYMENT: {
              showItemUnitPrice: true,
              itemUnitPricePlacement: 'SEPARATE_COLUMN',
            },
          }),
        } as any,
      },
    );

    const text = new TextDecoder('utf-8').decode(bytes);
    expect(text).toContain('Mat hang');
    expect(text).toContain('SL/TL');
    expect(text).toContain('D.Gia');
    expect(text).toContain('Thanh tien');
    expect(text).toContain('65.000');
    expect(text).toContain('50.000');
    expect(text).not.toContain('┬╥');
  });

  it('normalizes middle dots and typography symbols into safe ASCII equivalents', () => {
    const bytes = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'HD-101',
        orderType: 'DINE_IN',
        tableName: 'Bàn 01 · Khu vực 1',
        cashierName: 'Thu ngân',
        subtotal: 50000,
        discountTotal: 0,
        total: 50000,
        issuedAtMs: Date.now(),
        lines: [
          {
            id: 'time-1',
            name: 'Tiền giờ',
            quantity: 1,
            unitPrice: 50000,
            totalPrice: 50000,
            isTime: true,
            timeStartedAtMs: Date.now() - 3600000,
            timeEndedAtMs: Date.now(),
            timeElapsedSeconds: 3600,
            timeSegments: [
              {
                name: 'Giờ thường',
                type: 'BASE',
                startedAtMs: Date.now() - 3600000,
                endedAtMs: Date.now(),
                elapsedSeconds: 3600,
                priceVnd: 50000,
                amount: 50000,
              },
            ],
          },
        ],
      },
      {
        paperSize: 'K80',
        printSettings: {
          templateConfigJson: JSON.stringify({
            PAYMENT: {
              showHourlyDetail: true,
              hourlyDetailMode: 'FULL_TIMELOG',
              showHourlyUnitPrice: true,
            },
          }),
        } as any,
      },
    );

    const text = new TextDecoder('utf-8').decode(bytes);
    expect(text).not.toContain('·');
    expect(text).not.toContain('┬╥');
    expect(text).toContain('Ban 01 - Khu vuc 1');
  });
});
