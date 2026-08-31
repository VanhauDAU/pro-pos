import { describe, expect, it } from 'vitest';

import { revenueReportQuerySchema } from '../../src/contracts/revenue-report';
import { buildEscPosRevenueReport } from '../../src/printing/escpos/revenue-report-builder';
import { JobProcessor } from '../../apps/print-agent/src/job-processor';
import { AgentApiClient } from '../../apps/print-agent/src/api-client';
import type { PrintJob } from '../../src/contracts/print-job';
import {
  isTimestampInRevenueReportHour,
  resolveRevenueReportRange,
} from '../../src/server/services/owner-revenue-report-service';

async function revenueReportAgentGet(path: string) {
  if (path === '/api/v1/pos/print-bootstrap') {
    return {
      context: { storeName: 'Cửa hàng kiểm thử' },
      configVersion: 1,
      printSettings: {
        storeId: 'store-1',
        paperSize: 'K80',
        printersJson: JSON.stringify({
          networkIp: '192.168.1.73',
          networkPort: 9100,
          autoCut: true,
          vietnameseMode: 'UNACCENTED',
        }),
      },
    };
  }
  if (path === '/api/v1/owner/analytics/reports/revenue/print/snapshot-1') {
    return {
      id: 'snapshot-1',
      storeId: 'store-1',
      requestedByName: 'Thu ngân',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      report: {
        reportType: 'OVERVIEW',
        selectedEmployeeId: null,
        timeRange: 'today',
        timezone: 'Asia/Ho_Chi_Minh',
        businessDayCutoffMinutes: 0,
        fromMs: Date.now() - 3_600_000,
        toMs: Date.now(),
        generatedAt: Date.now(),
        dayCount: 1,
        timelineGranularity: 'hour',
        summary: {
          completedInvoiceCount: 1,
          cancelledOrderCount: 0,
          productQuantity: 1,
          grossRevenue: 50_000,
          cancelledAmount: 0,
          discountAmount: 0,
          netRevenue: 50_000,
          averageItemsPerInvoice: 1,
          averageRevenuePerInvoice: 50_000,
        },
        hourlyAverage: [],
        timeline: [],
        paymentMethods: [
          { key: 'CASH', label: 'Tiền mặt', invoiceCount: 1, amount: 50_000, percentage: 100 },
        ],
        orderTypes: [
          {
            key: 'DINE_IN',
            label: 'Tại bàn',
            invoiceCount: 1,
            amount: 50_000,
            percentage: 100,
          },
        ],
        staffRevenue: [],
        staffOptions: [],
        cancellations: [],
      },
    };
  }
  throw new Error(`Unexpected GET ${path}`);
}

describe('Revenue report ranges and thermal output', () => {
  it('resolves business-day ranges in the store timezone and cutoff', () => {
    const now = Date.parse('2026-08-31T01:00:00.000Z'); // 08:00 in Vietnam
    const range = resolveRevenueReportRange(
      revenueReportQuerySchema.parse({ timeRange: 'today' }),
      'Asia/Ho_Chi_Minh',
      360,
      now,
    );
    expect(range).toEqual({
      dateFrom: '2026-08-31',
      dateTo: '2026-08-31',
      fromMs: Date.parse('2026-08-30T23:00:00.000Z'),
      toMs: now,
      dayCount: 1,
    });
  });

  it('uses the previous business date before the cutoff', () => {
    const now = Date.parse('2026-08-30T21:30:00.000Z'); // 04:30 on 31/08 in Vietnam
    const range = resolveRevenueReportRange(
      revenueReportQuerySchema.parse({ timeRange: 'today' }),
      'Asia/Ho_Chi_Minh',
      360,
      now,
    );
    expect(range.dateFrom).toBe('2026-08-30');
    expect(range.fromMs).toBe(Date.parse('2026-08-29T23:00:00.000Z'));
    expect(range.toMs).toBe(now);
  });

  it('accepts cross-midnight custom hour windows', () => {
    const query = revenueReportQuerySchema.parse({
      hourMode: 'custom',
      fromHour: 22,
      fromMinute: 0,
      toHour: 6,
      toMinute: 0,
    });
    expect(
      isTimestampInRevenueReportHour(
        Date.parse('2026-08-31T16:30:00.000Z'),
        query,
        'Asia/Ho_Chi_Minh',
      ),
    ).toBe(true);
    expect(
      isTimestampInRevenueReportHour(
        Date.parse('2026-08-31T05:00:00.000Z'),
        query,
        'Asia/Ho_Chi_Minh',
      ),
    ).toBe(false);
  });

  it('renders a one-copy K58 report and never opens the cash drawer', () => {
    const bytes = buildEscPosRevenueReport(
      {
        id: 'snapshot-1',
        storeId: 'store-1',
        requestedByName: 'Nguyễn Thu Ngân',
        createdAt: Date.parse('2026-08-31T00:00:00.000Z'),
        expiresAt: Date.parse('2026-09-07T00:00:00.000Z'),
        report: {
          reportType: 'OVERVIEW',
          selectedEmployeeId: null,
          timeRange: 'today',
          timezone: 'Asia/Ho_Chi_Minh',
          businessDayCutoffMinutes: 0,
          fromMs: Date.parse('2026-08-30T17:00:00.000Z'),
          toMs: Date.parse('2026-08-31T00:00:00.000Z'),
          generatedAt: Date.parse('2026-08-31T00:00:00.000Z'),
          dayCount: 1,
          timelineGranularity: 'hour',
          summary: {
            completedInvoiceCount: 2,
            cancelledOrderCount: 1,
            productQuantity: 5,
            grossRevenue: 100_000,
            cancelledAmount: 20_000,
            discountAmount: 10_000,
            netRevenue: 90_000,
            averageItemsPerInvoice: 2.5,
            averageRevenuePerInvoice: 45_000,
          },
          hourlyAverage: [],
          timeline: [
            {
              key: '08',
              label: '08:00',
              completedInvoiceCount: 2,
              cancelledOrderCount: 1,
              grossRevenue: 100_000,
              cancelledAmount: 20_000,
              discountAmount: 10_000,
              netRevenue: 90_000,
              averageRevenuePerInvoice: 45_000,
            },
          ],
          paymentMethods: [
            { key: 'CASH', label: 'Tiền mặt', invoiceCount: 2, amount: 90_000, percentage: 100 },
          ],
          orderTypes: [
            { key: 'DINE_IN', label: 'Tại bàn', invoiceCount: 2, amount: 90_000, percentage: 100 },
          ],
          staffRevenue: [],
          staffOptions: [],
          cancellations: [],
        },
      },
      {
        paperSize: 'K58',
        autoCut: true,
        storeName: 'Cửa hàng kiểm thử',
        vietnameseMode: 'UNACCENTED',
      },
    );
    const printable = new TextDecoder().decode(bytes);
    expect(printable).toContain('DOANH THU TONG QUAN');
    expect(printable).toContain('DOANH THU THUAN');
    expect(printable).toContain('90.000d');
    const drawerCommand = [0x1b, 0x70, 0x00, 0x19, 0xfa];
    expect(
      [...bytes].some((_, index, values) =>
        drawerCommand.every((value, offset) => values[index + offset] === value),
      ),
    ).toBe(false);
    expect([...bytes].slice(-4)).toEqual([0x1d, 0x56, 0x41, 0x00]);
  });

  it('loads, prints and completes revenue_report jobs through the Print Agent lifecycle', async () => {
    const postCalls: string[] = [];
    class RevenueReportAgentApiClient extends AgentApiClient {
      override async get<T>(path: string): Promise<T> {
        return (await revenueReportAgentGet(path)) as T;
      }

      override async getBytes() {
        return { bytes: new Uint8Array(), contentType: 'image/png' };
      }

      override async getPublicPng() {
        return new Uint8Array();
      }

      override async post<T>(path: string): Promise<T> {
        postCalls.push(path);
        return (path.endsWith('/claim') ? { claimToken: null } : {}) as T;
      }
    }
    const api = new RevenueReportAgentApiClient({ serverUrl: 'https://pos.example' });
    let sent: Uint8Array | null = null;
    const processor = new JobProcessor(
      { serverUrl: 'https://pos.example', printerIp: '192.168.1.73', printerPort: 9100 },
      api,
      {
        send: async (bytes) => {
          sent = bytes;
        },
      },
    );
    const result = await processor.processJob({
      id: 'job-1',
      storeId: 'store-1',
      targetDeviceId: null,
      printerRole: 'receipt',
      documentType: 'revenue_report',
      documentId: 'snapshot-1',
      idempotencyKey: 'revenue-report-job-1',
      status: 'QUEUED',
      requestedByUserId: 'user-1',
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
      claimProtocolVersion: 1,
    } satisfies PrintJob);
    expect(result).toBe(true);
    expect(sent).not.toBeNull();
    expect(new TextDecoder().decode(sent!)).toContain('DOANH THU TONG QUAN');
    expect(postCalls).toEqual([
      '/api/v1/pos/print-jobs/job-1/claim',
      '/api/v1/pos/print-jobs/job-1/start',
      '/api/v1/pos/print-jobs/job-1/complete',
    ]);
  });
});
