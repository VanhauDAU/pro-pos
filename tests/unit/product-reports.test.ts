import { describe, expect, it } from 'vitest';
import { productReportQuerySchema } from '../../src/contracts/reports';
import { buildEscPosProductReport } from '../../src/printing/escpos/product-report-builder';
import { JobProcessor } from '../../apps/print-agent/src/job-processor';
import { AgentApiClient } from '../../apps/print-agent/src/api-client';
import type { PrintJob } from '../../src/contracts/print-job';
import {
  allocateProductReportInvoiceDiscounts,
  buildProductReportSummary,
  isTimestampInReportHour,
  resolveProductReportCompareRange,
  resolveProductReportDateRange,
} from '../../src/server/services/owner-product-report-service';
import type { RawReportLineRow } from '../../src/server/repositories/owner-product-report-repository';

describe('Product Report Query Schema & Calculations', () => {
  it('parses valid query with default values', () => {
    const parsed = productReportQuerySchema.parse({});
    expect(parsed.reportType).toBe('CATEGORY');
    expect(parsed.timeRange).toBe('this_week');
    expect(parsed.hourMode).toBe('all');
    expect(parsed.fromHour).toBe(0);
    expect(parsed.fromMinute).toBe(0);
    expect(parsed.toHour).toBe(0);
    expect(parsed.toMinute).toBe(0);
    expect(parsed.compareWith).toBe('previous_period');
  });

  it('parses custom date range and specific hours', () => {
    const parsed = productReportQuerySchema.parse({
      reportType: 'TOP_SELLING',
      timeRange: 'custom',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-15',
      hourMode: 'custom',
      fromHour: 8,
      fromMinute: 30,
      toHour: 22,
      toMinute: 45,
      compareWith: 'same_period_last_year',
    });

    expect(parsed.reportType).toBe('TOP_SELLING');
    expect(parsed.timeRange).toBe('custom');
    expect(parsed.dateFrom).toBe('2026-08-01');
    expect(parsed.dateTo).toBe('2026-08-15');
    expect(parsed.hourMode).toBe('custom');
    expect(parsed.fromHour).toBe(8);
    expect(parsed.fromMinute).toBe(30);
    expect(parsed.toHour).toBe(22);
    expect(parsed.toMinute).toBe(45);
    expect(parsed.compareWith).toBe('same_period_last_year');

    // Also test week & month comparison
    expect(
      productReportQuerySchema.parse({ compareWith: 'same_period_last_week' }).compareWith,
    ).toBe('same_period_last_week');
    expect(
      productReportQuerySchema.parse({ compareWith: 'same_period_last_month' }).compareWith,
    ).toBe('same_period_last_month');
  });

  it('rejects invalid reportType or hour range bounds', () => {
    expect(() =>
      productReportQuerySchema.parse({
        reportType: 'INVALID_TYPE',
      }),
    ).toThrow();

    expect(() =>
      productReportQuerySchema.parse({
        fromHour: 25,
      }),
    ).toThrow();

    expect(() =>
      productReportQuerySchema.parse({
        toMinute: 60,
      }),
    ).toThrow();

    expect(() =>
      productReportQuerySchema.parse({
        timeRange: 'custom',
        dateFrom: '2026-08-20',
      }),
    ).toThrow();

    expect(() =>
      productReportQuerySchema.parse({
        timeRange: 'custom',
        dateFrom: '2026-08-20',
        dateTo: '2026-08-10',
      }),
    ).toThrow();
  });

  it('computes category ratios and net amounts accurately', () => {
    const items = [
      { category: 'Cà phê', quantity: 20, gross: 400000, discount: 20000, net: 380000 },
      { category: 'Trà sữa', quantity: 30, gross: 600000, discount: 0, net: 600000 },
    ];

    const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalGross = items.reduce((sum, i) => sum + i.gross, 0);

    expect(totalQty).toBe(50);
    expect(totalGross).toBe(1000000);

    const ratios = items.map((i) => ({
      category: i.category,
      qtyRatio: Number(((i.quantity / totalQty) * 100).toFixed(1)),
      grossRatio: Number(((i.gross / totalGross) * 100).toFixed(1)),
    }));

    expect(ratios[0]).toEqual({ category: 'Cà phê', qtyRatio: 40, grossRatio: 40 });
    expect(ratios[1]).toEqual({ category: 'Trà sữa', qtyRatio: 60, grossRatio: 60 });
  });

  it('resolves current and custom ranges in Vietnam time without UTC date drift', () => {
    const now = Date.parse('2026-08-27T16:30:00.000Z'); // 23:30 in Vietnam
    const thisWeek = resolveProductReportDateRange(
      productReportQuerySchema.parse({ timeRange: 'this_week' }),
      now,
    );
    expect(thisWeek).toEqual({
      fromMs: Date.parse('2026-08-23T17:00:00.000Z'),
      toMs: now,
    });

    const custom = resolveProductReportDateRange(
      productReportQuerySchema.parse({
        timeRange: 'custom',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-15',
      }),
      now,
    );
    expect(custom).toEqual({
      fromMs: Date.parse('2026-07-31T17:00:00.000Z'),
      toMs: Date.parse('2026-08-15T16:59:59.999Z'),
    });
  });

  it('compares the exact same elapsed duration for the previous period', () => {
    const fromMs = Date.parse('2026-08-23T17:00:00.000Z');
    const toMs = Date.parse('2026-08-27T16:30:00.000Z');
    const comparison = resolveProductReportCompareRange('previous_period', fromMs, toMs);
    expect(comparison.compareToMs).toBe(fromMs - 1);
    expect(comparison.compareToMs! - comparison.compareFromMs! + 1).toBe(toMs - fromMs + 1);
  });

  it('supports overnight hour windows and treats equal endpoints as a full day', () => {
    const overnight = productReportQuerySchema.parse({
      hourMode: 'custom',
      fromHour: 22,
      toHour: 6,
    });
    expect(isTimestampInReportHour(Date.parse('2026-08-27T16:30:00.000Z'), overnight)).toBe(true);
    expect(isTimestampInReportHour(Date.parse('2026-08-27T05:00:00.000Z'), overnight)).toBe(false);

    const fullDay = productReportQuerySchema.parse({
      hourMode: 'custom',
      fromHour: 8,
      toHour: 8,
    });
    expect(isTimestampInReportHour(Date.parse('2026-08-27T05:00:00.000Z'), fullDay)).toBe(true);
  });

  it('uses frozen invoice gross totals instead of recalculating from the current price', () => {
    const line: RawReportLineRow = {
      lineId: 'line-1',
      invoiceId: 'invoice-1',
      referenceCode: 'HD-001',
      issuedAt: Date.parse('2026-08-27T10:00:00.000Z'),
      lineType: 'PRODUCT',
      productId: 'product-1',
      productCode: 'SP001',
      productName: 'Mỳ hải sản',
      unitName: 'Tô',
      categoryId: 'category-1',
      categoryName: 'Đồ ăn',
      quantityMilli: 1500,
      unitPrice: 60_001,
      grossLineTotal: 90_000,
      discountValue: 10_000,
      lineTotal: 80_000,
      invoiceDiscountTotal: 10_000,
      orderType: 'DINE_IN',
    };
    expect(buildProductReportSummary([line], [], 'none')).toMatchObject({
      totalQuantity: 1.5,
      grossAmount: 90_000,
      discountAmount: 10_000,
      netAmount: 80_000,
      totalAmount: 80_000,
    });
  });

  it('allocates invoice-level discounts exactly across product and time lines', () => {
    const base: RawReportLineRow = {
      lineId: 'product-line',
      invoiceId: 'invoice-promotion',
      referenceCode: 'HD-002',
      issuedAt: Date.parse('2026-08-27T10:00:00.000Z'),
      lineType: 'PRODUCT',
      productId: 'product-1',
      productCode: 'SP001',
      productName: 'Mỳ hải sản',
      unitName: 'Tô',
      categoryId: 'category-1',
      categoryName: 'Đồ ăn',
      quantityMilli: 1000,
      unitPrice: 60_000,
      grossLineTotal: 60_000,
      discountValue: 0,
      lineTotal: 60_000,
      invoiceDiscountTotal: 20_000,
      orderType: 'DINE_IN',
    };
    const allocated = allocateProductReportInvoiceDiscounts([
      base,
      {
        ...base,
        lineId: 'time-line',
        lineType: 'TIME',
        productId: 'time-1',
        productName: 'Tiền giờ',
        grossLineTotal: 40_000,
        lineTotal: 40_000,
      },
    ]);

    expect(allocated).toEqual([
      expect.objectContaining({ lineId: 'product-line', discountValue: 12_000, lineTotal: 48_000 }),
      expect.objectContaining({ lineId: 'time-line', discountValue: 8_000, lineTotal: 32_000 }),
    ]);
    expect(allocated.reduce((sum, line) => sum + line.discountValue, 0)).toBe(20_000);
  });

  it('builds ESC/POS product report bytes with categories and summaries', () => {
    const bytes = buildEscPosProductReport(
      {
        id: 'snapshot-1',
        storeId: 'store-1',
        requestedByUserId: 'user-1',
        requestedByName: 'Thu ngân',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        report: {
          reportType: 'CATEGORY',
          timeRange: 'today',
          fromMs: Date.now() - 3_600_000,
          toMs: Date.now(),
          compareFromMs: null,
          compareToMs: null,
          generatedAt: Date.now(),
          summary: {
            totalQuantity: 5,
            grossAmount: 100_000,
            discountAmount: 10_000,
            netAmount: 90_000,
            taxAmount: 0,
            totalAmount: 90_000,
            comparison: null,
          },
          chart: [],
          quantityChart: [],
          categoryRows: [
            {
              categoryId: 'cat-1',
              categoryName: 'Đồ uống',
              unitName: 'Ly',
              quantity: 5,
              quantityRatio: 100,
              grossAmount: 100_000,
              grossAmountRatio: 100,
              discountAmount: 10_000,
              netAmount: 90_000,
              taxAmount: 0,
              totalAmount: 90_000,
              products: [
                {
                  productId: 'prod-1',
                  productCode: 'CF01',
                  productName: 'Cà phê sữa',
                  unitName: 'Ly',
                  quantity: 5,
                  grossAmount: 100_000,
                  discountAmount: 10_000,
                  netAmount: 90_000,
                  taxAmount: 0,
                  totalAmount: 90_000,
                },
              ],
            },
          ],
          topSellingRows: [],
          modifierRows: [],
          comboRows: [],
          cancelledRows: [],
        },
      },
      { paperSize: 'K80', autoCut: true, storeName: 'PRO POS BIDA' },
    );

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('PRO POS BIDA');
    expect(text).toContain('BAO CAO THEO DANH MUC');
    expect(text).toContain('DOANH THU THUAN');
    expect(text).toContain('90.000d');
    expect(text).toContain('[Do uong]');
    expect(text).toContain('Ca phe sua (Ly)');
  });

  it('loads, prints and completes product_report jobs through the Print Agent lifecycle', async () => {
    const postCalls: string[] = [];
    class ProductReportAgentApiClient extends AgentApiClient {
      override async get<T>(path: string): Promise<T> {
        if (path === '/api/v1/pos/print-bootstrap') {
          return {
            context: { storeName: 'PRO POS BIDA' },
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
          } as T;
        }
        if (path === '/api/v1/owner/analytics/reports/products/print/snapshot-prod-1') {
          return {
            id: 'snapshot-prod-1',
            storeId: 'store-1',
            requestedByName: 'Thu ngân',
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            report: {
              reportType: 'TOP_SELLING',
              timeRange: 'today',
              fromMs: Date.now() - 3_600_000,
              toMs: Date.now(),
              compareFromMs: null,
              compareToMs: null,
              generatedAt: Date.now(),
              summary: {
                totalQuantity: 10,
                grossAmount: 200_000,
                discountAmount: 0,
                netAmount: 200_000,
                taxAmount: 0,
                totalAmount: 200_000,
                comparison: null,
              },
              chart: [],
              quantityChart: [],
              categoryRows: [],
              topSellingRows: [
                {
                  rank: 1,
                  productId: 'prod-1',
                  productCode: 'CF01',
                  productName: 'Cà phê đá',
                  categoryName: 'Đồ uống',
                  unitName: 'Ly',
                  quantity: 10,
                  grossAmount: 200_000,
                  discountAmount: 0,
                  netAmount: 200_000,
                  averagePrice: 20_000,
                },
              ],
              modifierRows: [],
              comboRows: [],
              cancelledRows: [],
            },
          } as T;
        }
        throw new Error(`Unexpected GET ${path}`);
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

    const api = new ProductReportAgentApiClient({ serverUrl: 'https://pos.example' });
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
      id: 'job-prod-1',
      storeId: 'store-1',
      targetDeviceId: null,
      printerRole: 'receipt',
      documentType: 'product_report',
      documentId: 'snapshot-prod-1',
      idempotencyKey: 'product-report-job-1',
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
    expect(new TextDecoder().decode(sent!)).toContain('MAT HANG BAN CHAY');
    expect(new TextDecoder().decode(sent!)).toContain('#1. Ca phe da (Ly)');
    expect(postCalls).toEqual([
      '/api/v1/pos/print-jobs/job-prod-1/claim',
      '/api/v1/pos/print-jobs/job-prod-1/start',
      '/api/v1/pos/print-jobs/job-prod-1/complete',
    ]);
  });
});
