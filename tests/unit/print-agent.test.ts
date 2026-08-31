import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../../apps/print-agent/src/job-queue';
import { isDesktopPlatform } from '../../src/client/lib/print-bridge-service';
import { buildEscPosTextReceipt } from '../../src/printing/escpos/escpos-text-builder';
import {
  JobProcessor,
  loadPrintDataForJob,
  PrintJobProcessingError,
  resolveAgentVietnameseMode,
} from '../../apps/print-agent/src/job-processor';
import type { AgentApiClient } from '../../apps/print-agent/src/api-client';
import type { PrintJob } from '../../src/contracts/print-job';
import { PrinterError } from '../../src/printing/printer-errors';
import { AgentPrintCache } from '../../apps/print-agent/src/core/print-cache';

describe('Pro POS Print Agent Unit Tests', () => {
  it('single-flights bootstrap refresh and fences invalidation that arrives mid-refresh', async () => {
    let releaseFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const get = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        context: { storeName: 'Store v2' },
        printSettings: { storeId: 'STORE-1', updatedAt: 2 },
        configVersion: 2,
      });
    const cache = new AgentPrintCache({ get } as never);

    const a = cache.resolve();
    const b = cache.resolve();
    cache.invalidate(2);
    releaseFirst({
      context: { storeName: 'Store v1' },
      printSettings: { storeId: 'STORE-1', updatedAt: 1 },
      configVersion: 1,
    });

    await expect(a).resolves.toMatchObject({ configVersion: 2 });
    await expect(b).resolves.toMatchObject({ configVersion: 2 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('uses stale bootstrap only inside the configured maximum stale age', async () => {
    let now = 0;
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        context: { storeName: 'Cached Store' },
        printSettings: { storeId: 'STORE-1', updatedAt: 1 },
        configVersion: 1,
      })
      .mockRejectedValue(new Error('bootstrap offline'));
    const cache = new AgentPrintCache({ get } as never, {
      ttlMs: 60_000,
      maxStaleMs: 300_000,
      now: () => now,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await cache.resolve();
    now = 61_000;
    await expect(cache.resolve()).resolves.toMatchObject({ configVersion: 1 });
    now = 300_001;
    await expect(cache.resolve()).rejects.toMatchObject({ name: 'PrintBootstrapStaleError' });
    warn.mockRestore();
  });

  it('caches raster work by media, paper size and config version', async () => {
    const cache = new AgentPrintCache({} as never);
    const loader = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const key = {
      kind: 'logo' as const,
      mediaId: 'MEDIA-1',
      paperSize: 'K80',
      configVersion: 1,
      width: 200,
      height: 100,
    };

    await cache.getRaster(key, loader);
    await cache.getRaster(key, loader);
    await cache.getRaster({ ...key, configVersion: 2 }, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('uses reliable text encoding when a printer reports the problematic WPC1258 mode', () => {
    expect(resolveAgentVietnameseMode('WPC1258')).toBe('UNACCENTED');
    expect(resolveAgentVietnameseMode('UNACCENTED')).toBe('UNACCENTED');
    expect(resolveAgentVietnameseMode('UTF8')).toBe('UTF8');
  });

  it('loads invoice snapshots as PAYMENT without falling back to an order quote', async () => {
    const get = vi.fn(async (path: string) => {
      expect(path).toBe('/api/v1/pos/invoices/INV_1');
      return {
        invoice: {
          id: 'INV_1',
          displayCode: 'HD-1',
          totalVnd: 100000,
          issuedAt: 1720000000000,
        },
        lines: [],
        payment: { method: 'CASH', cashReceived: 100000, cashChange: 0 },
      };
    });
    const data = await loadPrintDataForJob({ get } as never, {
      documentType: 'invoice',
      documentId: 'INV_1',
    });
    expect(get).toHaveBeenCalledOnce();
    expect(data.receiptType).toBe('PAYMENT');
    expect(data.invoiceCode).toBe('HD-1');
  });

  it('loads provisional jobs only from the order quote endpoint', async () => {
    const get = vi.fn(async () => ({
      order: { id: 'ORDER_1', displayCode: 'D-1', orderType: 'DINE_IN' },
      items: [],
      totalVnd: 50000,
    }));
    const data = await loadPrintDataForJob({ get } as never, {
      documentType: 'provisional',
      documentId: 'ORDER_1',
    });
    expect(get).toHaveBeenCalledWith('/api/v1/pos/orders/ORDER_1/quote');
    expect(data.receiptType).toBe('PROVISIONAL');
  });

  it('fails unknown document types instead of silently building provisional', async () => {
    const get = vi.fn();
    await expect(
      loadPrintDataForJob(
        { get } as never,
        {
          documentType: 'order',
          documentId: 'ORDER_1',
        } as never,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT_TYPE',
    } satisfies Partial<PrintJobProcessingError>);
    expect(get).not.toHaveBeenCalled();
  });

  it('continues printing text when an optional logo cannot be loaded', async () => {
    const post = vi.fn(async () => ({}));
    const get = vi.fn(async (path: string) => {
      if (path === '/api/v1/pos/print-bootstrap') {
        return {
          context: null,
          configVersion: 1,
          printSettings: {
            storeId: 'STORE-1',
            logoMediaId: 'LOGO-1',
            paperSize: 'K80',
            printersJson: JSON.stringify({
              networkIp: '192.168.1.10',
              networkPort: 9100,
              paperSize: 'K80',
              vietnameseMode: 'UNACCENTED',
            }),
            paymentCopyCount: 1,
            provisionalCopyCount: 1,
          },
        };
      }
      if (path === '/api/v1/pos/context') return null;
      if (path === '/api/v1/pos/print-settings') {
        return {
          storeId: 'STORE-1',
          logoMediaId: 'LOGO-1',
          paperSize: 'K80',
          printersJson: JSON.stringify({
            networkIp: '192.168.1.10',
            networkPort: 9100,
            paperSize: 'K80',
            vietnameseMode: 'UNACCENTED',
          }),
          paymentCopyCount: 1,
          provisionalCopyCount: 1,
        };
      }
      if (path === '/api/v1/pos/invoices/INV_1') {
        return {
          invoice: {
            id: 'INV_1',
            displayCode: 'HD-1',
            totalVnd: 100000,
            issuedAt: 1720000000000,
          },
          lines: [],
          payment: { method: 'CASH' },
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const getBytes = vi.fn(async () => {
      throw new Error('logo offline');
    });
    const send = vi.fn(async () => undefined);
    const api = { get, getBytes, post } as unknown as AgentApiClient;
    const processor = new JobProcessor(
      { serverUrl: 'https://pos.example', agentId: 'AGENT-1', storeName: 'ĐẠI BILLIARDS' },
      api,
      { send },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = {
      id: 'JOB-1',
      documentType: 'invoice',
      documentId: 'INV_1',
    } as PrintJob;

    await expect(processor.processJob(job)).resolves.toBe(true);
    expect(getBytes).toHaveBeenCalledWith('/api/v1/pos/print-media/LOGO-1');
    expect(send).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/api/v1/pos/print-jobs/JOB-1/complete', {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Bỏ qua logo optional'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('không trả store context'));
    warn.mockRestore();
  });

  it('marks a job UNCERTAIN rather than retrying when socket failure follows a write attempt', async () => {
    const post = vi.fn(async () => ({}));
    const get = vi.fn(async (path: string) => {
      if (path === '/api/v1/pos/print-bootstrap') {
        return {
          context: { storeName: 'ĐẠI BILLIARDS' },
          configVersion: 1,
          printSettings: {
            storeId: 'STORE-1',
            paperSize: 'K80',
            printersJson: JSON.stringify({ networkIp: '192.168.1.10', networkPort: 9100 }),
            paymentCopyCount: 1,
            provisionalCopyCount: 1,
          },
        };
      }
      if (path === '/api/v1/pos/context') return { storeName: 'ĐẠI BILLIARDS' };
      if (path === '/api/v1/pos/print-settings') {
        return {
          storeId: 'STORE-1',
          paperSize: 'K80',
          printersJson: JSON.stringify({ networkIp: '192.168.1.10', networkPort: 9100 }),
          paymentCopyCount: 1,
          provisionalCopyCount: 1,
        };
      }
      if (path === '/api/v1/pos/invoices/INV_2') {
        return {
          invoice: { id: 'INV_2', displayCode: 'HD-2', totalVnd: 100000, issuedAt: 1720000000000 },
          lines: [],
          payment: { method: 'CASH' },
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const api = { get, getBytes: vi.fn(), post } as unknown as AgentApiClient;
    const processor = new JobProcessor(
      { serverUrl: 'https://pos.example', agentId: 'AGENT-1', storeName: 'ĐẠI BILLIARDS' },
      api,
      {
        send: async () => {
          throw new PrinterError('SOCKET_WRITE_ERROR', 'socket closed', {
            failureStage: 'DURING_WRITE',
          });
        },
      },
    );

    await expect(
      processor.processJob({
        id: 'JOB-UNCERTAIN',
        documentType: 'invoice',
        documentId: 'INV_2',
      } as PrintJob),
    ).resolves.toBe(false);
    expect(post).toHaveBeenLastCalledWith('/api/v1/pos/print-jobs/JOB-UNCERTAIN/uncertain', {
      failureCode: 'SOCKET_WRITE_ERROR',
      failureMessage: 'socket closed',
    });
  });

  it('retries TCP exactly once only when no byte was written', async () => {
    const post = vi.fn(async (path: string) =>
      path.endsWith('/claim') ? { claimToken: null } : {},
    );
    const get = vi.fn(async (path: string) => {
      if (path === '/api/v1/pos/print-bootstrap') {
        return {
          context: { storeName: 'RETRY STORE' },
          configVersion: 1,
          printSettings: {
            storeId: 'STORE-1',
            updatedAt: 1,
            paperSize: 'K80',
            printersJson: JSON.stringify({ networkIp: '192.168.1.10', networkPort: 9100 }),
            paymentCopyCount: 1,
            provisionalCopyCount: 1,
          },
        };
      }
      if (path === '/api/v1/pos/invoices/INV-TCP-RETRY') {
        return {
          invoice: {
            id: 'INV-TCP-RETRY',
            displayCode: 'HD-TCP-RETRY',
            totalVnd: 10000,
            issuedAt: 1720000000000,
          },
          lines: [],
          payment: { method: 'CASH' },
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new PrinterError('CONNECTION_TIMEOUT', 'connect timeout', {
          failureStage: 'BEFORE_WRITE',
        }),
      )
      .mockResolvedValueOnce(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const processor = new JobProcessor(
      { serverUrl: 'https://pos.example', agentId: 'AGENT-1' },
      { get, getBytes: vi.fn(), post } as unknown as AgentApiClient,
      { send },
    );

    await expect(
      processor.processJob({
        id: 'JOB-TCP-RETRY',
        documentType: 'invoice',
        documentId: 'INV-TCP-RETRY',
      } as PrintJob),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('renders all data before start and starts immediately before the TCP write', async () => {
    const order: string[] = [];
    const claimToken = '11111111-1111-4111-8111-111111111111';
    const get = vi.fn(async (path: string) => {
      if (path === '/api/v1/pos/print-bootstrap') {
        order.push('bootstrap');
        return {
          context: { storeName: 'FAST STORE' },
          configVersion: 1,
          printSettings: {
            storeId: 'STORE-1',
            updatedAt: 1,
            paperSize: 'K80',
            printersJson: JSON.stringify({ networkIp: '192.168.1.10', networkPort: 9100 }),
            paymentCopyCount: 1,
            provisionalCopyCount: 1,
          },
        };
      }
      if (path === '/api/v1/pos/invoices/INV-ORDER') {
        order.push('document');
        return {
          invoice: {
            id: 'INV-ORDER',
            displayCode: 'HD-ORDER',
            totalVnd: 10000,
            issuedAt: 1720000000000,
          },
          lines: [],
          payment: { method: 'CASH' },
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/claim')) order.push('claim');
      if (path.endsWith('/start')) order.push('start');
      if (path.endsWith('/complete')) order.push('complete');
      return path.endsWith('/claim') ? { claimToken } : {};
    });
    const send = vi.fn(async () => {
      order.push('tcp');
    });
    const processor = new JobProcessor(
      { serverUrl: 'https://pos.example', agentId: 'AGENT-1' },
      { get, getBytes: vi.fn(), post } as unknown as AgentApiClient,
      { send },
    );

    await expect(
      processor.processJob({
        id: 'JOB-ORDER',
        documentType: 'invoice',
        documentId: 'INV-ORDER',
      } as PrintJob),
    ).resolves.toBe(true);

    expect(order.indexOf('claim')).toBeLessThan(order.indexOf('bootstrap'));
    expect(order.indexOf('claim')).toBeLessThan(order.indexOf('document'));
    expect(order.indexOf('bootstrap')).toBeLessThan(order.indexOf('start'));
    expect(order.indexOf('document')).toBeLessThan(order.indexOf('start'));
    expect(order).toEqual(
      expect.arrayContaining(['claim', 'bootstrap', 'document', 'start', 'tcp', 'complete']),
    );
    expect(order.indexOf('start')).toBeLessThan(order.indexOf('tcp'));
    expect(order.indexOf('tcp')).toBeLessThan(order.indexOf('complete'));
    expect(post).toHaveBeenCalledWith('/api/v1/pos/print-jobs/JOB-ORDER/start', { claimToken });
    expect(post).toHaveBeenCalledWith('/api/v1/pos/print-jobs/JOB-ORDER/complete', { claimToken });
  });

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
    expect(text).toContain('T.tien');
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

  it('bolds table headings and omits separator rows around the grand total', () => {
    const bytes = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'HD-102',
        orderType: 'DINE_IN',
        subtotal: 110000,
        discountTotal: 0,
        total: 110000,
        issuedAtMs: Date.now(),
        lines: [
          {
            id: 'time',
            name: 'Tiền giờ',
            quantity: 1,
            unitPrice: 60000,
            totalPrice: 60000,
            isTime: true,
          },
          {
            id: 'item',
            name: 'Bia Tiger',
            quantity: 1,
            unitPrice: 50000,
            totalPrice: 50000,
          },
        ],
      },
      { paperSize: 'K80', vietnameseMode: 'UNACCENTED' },
    );
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('='.repeat(48));

    const boldOn = [0x1b, 0x45, 0x01];
    const headingIndexes = ['Thong tin gio', 'Mat hang'].map((heading) => text.indexOf(heading));
    for (const headingIndex of headingIndexes) {
      expect(headingIndex).toBeGreaterThan(2);
      expect(Array.from(bytes.slice(headingIndex - 3, headingIndex))).toEqual(boldOn);
    }
  });

  it('prints to USB Windows Spooler when local config is WINDOWS_PRINTER even if server bootstrap has networkIp', async () => {
    let capturedConnection: any = null;
    const mockTransport = {
      send: vi.fn(async (_data: Uint8Array, connection: any) => {
        capturedConnection = connection;
      }),
    };

    const apiClient = {
      post: vi.fn(async (url: string) => {
        if (url.includes('/claim')) return { claimToken: 'claim-tok-1' };
        return {};
      }),
      get: vi.fn(async (url: string) => {
        if (url.includes('/invoices/INV-1')) {
          return {
            invoice: {
              id: 'INV-1',
              orderCode: 'HD-USB-1',
              type: 'PAYMENT',
              paymentMethod: 'CASH',
              total: 100000,
              subtotal: 100000,
              discountTotal: 0,
              issuedAt: new Date().toISOString(),
              items: [],
            },
          };
        }
        return {};
      }),
    } as unknown as AgentApiClient;

    const mockPrintCache = {
      resolveWithMetadata: vi.fn(async () => ({
        cacheStatus: 'HIT' as const,
        bootstrap: {
          context: { storeName: 'Quán Test' },
          printSettings: {
            storeId: 'STORE-1',
            printersJson: JSON.stringify({
              connectionType: 'NETWORK_TCP',
              networkIp: '192.168.1.99', // Server says LAN IP
              networkPort: 9100,
            }),
          },
          configVersion: 1,
        },
      })),
      getRaster: vi.fn(async () => null),
    } as unknown as AgentPrintCache;

    const processor = new JobProcessor(
      {
        serverUrl: 'https://propos.test',
        connectionType: 'WINDOWS_PRINTER', // Local config specifies USB
        printerName: 'POS-80 USB Printer',
      },
      apiClient,
      mockTransport,
      mockPrintCache,
    );

    const job = {
      id: 'JOB-USB-LOCAL',
      storeId: 'STORE-1',
      targetDeviceId: null,
      printerRole: 'receipt',
      documentType: 'invoice' as const,
      documentId: 'INV-1',
      idempotencyKey: 'idem-1',
      status: 'QUEUED' as const,
      requestedByUserId: null,
      requestedByDeviceId: null,
      claimedByDeviceId: null,
      createdAt: Date.now(),
      claimedAt: null,
      printingAt: null,
      completedAt: null,
      failedAt: null,
      attemptCount: 0,
      failureCode: null,
      failureMessage: null,
      claimLeaseExpiresAt: null,
      claimGeneration: 0,
      claimProtocolVersion: 2,
    };

    const success = await processor.processJob(job);
    expect(success).toBe(true);
    expect(mockTransport.send).toHaveBeenCalledTimes(1);
    expect(capturedConnection).toEqual({
      type: 'WINDOWS_PRINTER',
      printerName: 'POS-80 USB Printer',
    });
  });

  it('reports uncertain to server when Windows Spooler fails during write', async () => {
    const mockTransport = {
      send: vi.fn(async () => {
        throw new PrinterError('WINDOWS_RAW_WRITE_FAILED', 'WritePrinter failed mid-stream', {
          failureStage: 'DURING_WRITE',
        });
      }),
    };

    let postedEndpoint = '';
    const apiClient = {
      post: vi.fn(async (url: string) => {
        if (url.includes('/claim')) return { claimToken: 'tok-uncertain' };
        if (url.includes('/uncertain')) postedEndpoint = 'uncertain';
        if (url.includes('/fail')) postedEndpoint = 'fail';
        return {};
      }),
      get: vi.fn(async () => ({
        invoice: {
          id: 'INV-UNCERTAIN',
          orderCode: 'HD-UNCERTAIN',
          type: 'PAYMENT',
          paymentMethod: 'CASH',
          total: 50000,
          subtotal: 50000,
          discountTotal: 0,
          issuedAt: new Date().toISOString(),
          items: [],
        },
      })),
    } as unknown as AgentApiClient;

    const mockPrintCache = {
      resolveWithMetadata: vi.fn(async () => ({
        cacheStatus: 'HIT' as const,
        bootstrap: {
          context: { storeName: 'Test' },
          printSettings: { storeId: 'S-1' },
          configVersion: 1,
        },
      })),
      getRaster: vi.fn(async () => null),
    } as unknown as AgentPrintCache;

    const processor = new JobProcessor(
      {
        serverUrl: 'https://propos.test',
        connectionType: 'WINDOWS_PRINTER',
        printerName: 'POS-80 Printer',
      },
      apiClient,
      mockTransport,
      mockPrintCache,
    );

    const job = {
      id: 'JOB-DURING-WRITE-ERR',
      storeId: 'S-1',
      targetDeviceId: null,
      printerRole: 'receipt',
      documentType: 'invoice' as const,
      documentId: 'INV-UNCERTAIN',
      idempotencyKey: 'idem-2',
      status: 'QUEUED' as const,
      requestedByUserId: null,
      requestedByDeviceId: null,
      claimedByDeviceId: null,
      createdAt: Date.now(),
      claimedAt: null,
      printingAt: null,
      completedAt: null,
      failedAt: null,
      attemptCount: 0,
      failureCode: null,
      failureMessage: null,
      claimLeaseExpiresAt: null,
      claimGeneration: 0,
      claimProtocolVersion: 2,
    };

    const success = await processor.processJob(job);
    expect(success).toBe(false);
    expect(postedEndpoint).toBe('uncertain');
  });
});
