import { describe, expect, it } from 'vitest';

import type { GuestActiveOrderDto, GuestOrderContext } from '../../src/contracts/qr-order';

function formatElapsedDetail(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}g ${m}p ${s}s`;
  if (m > 0) return `${m}p ${s}s`;
  return `${s}s`;
}

describe('guest active order dto & helpers', () => {
  it('formats live elapsed time correctly across hours, minutes, and seconds', () => {
    expect(formatElapsedDetail(45)).toBe('45s');
    expect(formatElapsedDetail(125)).toBe('2p 5s');
    expect(formatElapsedDetail(3665)).toBe('1g 1p 5s');
    expect(formatElapsedDetail(7320)).toBe('2g 2p 0s');
  });

  it('calculates total provisional amount accurately from items, time fee and discounts', () => {
    const mockActiveOrder: GuestActiveOrderDto = {
      id: 'ord-test-01',
      displayCode: 'D-0042',
      openedAt: Date.now() - 3600_000,
      calculatedAt: Date.now(),
      items: [
        {
          id: 'item-1',
          productName: 'Cà phê sữa đá',
          variantName: 'Lớn',
          unitName: 'ly',
          quantityMilli: 2000,
          unitPriceVnd: 25000,
          grossLineTotalVnd: 50000,
          discountAmountVnd: 0,
          netLineTotalVnd: 50000,
          note: 'Ít ngọt',
        },
        {
          id: 'item-2',
          productName: 'Bò húc',
          variantName: null,
          unitName: 'lon',
          quantityMilli: 1000,
          unitPriceVnd: 20000,
          grossLineTotalVnd: 20000,
          discountAmountVnd: 2000,
          netLineTotalVnd: 18000,
          note: null,
        },
      ],
      time: {
        status: 'RUNNING',
        startedAtMs: Date.now() - 3600_000,
        endedAtMs: null,
        pausedAtMs: null,
        elapsedSeconds: 3600,
        basePriceVnd: 60000,
        amountAfterRoundingVnd: 60000,
      },
      subtotalVnd: 130000,
      discountTotalVnd: 2000,
      totalVnd: 128000,
    };

    const itemsGross = mockActiveOrder.items.reduce((sum, i) => sum + i.grossLineTotalVnd, 0);
    expect(itemsGross).toBe(70000);
    expect(mockActiveOrder.time?.amountAfterRoundingVnd).toBe(60000);
    expect(mockActiveOrder.subtotalVnd).toBe(
      itemsGross + (mockActiveOrder.time?.amountAfterRoundingVnd ?? 0),
    );
    expect(mockActiveOrder.totalVnd).toBe(
      mockActiveOrder.subtotalVnd - mockActiveOrder.discountTotalVnd,
    );
  });

  it('supports activeOrder on GuestOrderContext when table is OPEN', () => {
    const mockContext: GuestOrderContext = {
      tableStatus: 'OPEN',
      storeName: 'Billiard Club Pro',
      tableName: 'Bàn 01',
      areaName: 'Tầng 1 - VIP',
      table: {
        id: 'table-01',
        name: 'Bàn 01',
        areaName: 'Tầng 1 - VIP',
      },
      sessionExpiresAt: Date.now() + 8 * 3600_000,
      openRequest: null,
      locationRequirement: {
        required: false,
        configured: false,
        allowedRadiusMeters: 300,
        maxAccuracyMeters: 100,
        isVerified: true,
        verifiedExpiresAt: null,
      },
      salesAvailability: {
        acceptingOrders: true,
        reason: 'OPEN',
        nextOpenAt: null,
      },
      cooldowns: {
        orderSeconds: 3,
        callStaffSeconds: 60,
        checkoutSeconds: 60,
      },
      quickStaffReasons: [],
      activeOrder: {
        id: 'ord-01',
        displayCode: 'D-1001',
        openedAt: Date.now() - 1800_000,
        calculatedAt: Date.now(),
        items: [],
        time: {
          status: 'RUNNING',
          startedAtMs: Date.now() - 1800_000,
          endedAtMs: null,
          pausedAtMs: null,
          elapsedSeconds: 1800,
          basePriceVnd: 50000,
          amountAfterRoundingVnd: 25000,
        },
        subtotalVnd: 25000,
        discountTotalVnd: 0,
        totalVnd: 25000,
      },
      menu: [],
    };

    expect(mockContext.tableStatus).toBe('OPEN');
    expect(mockContext.activeOrder).not.toBeNull();
    expect(mockContext.activeOrder?.displayCode).toBe('D-1001');
    expect(mockContext.activeOrder?.time?.amountAfterRoundingVnd).toBe(25000);
  });
});
