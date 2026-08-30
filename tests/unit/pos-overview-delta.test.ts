import { describe, expect, it } from 'vitest';

import { mergePosOverviewDelta } from '../../src/client/features/pos/pos-overview-delta';
import type { PosOverviewSnapshot } from '../../src/contracts/pos';

const base: PosOverviewSnapshot = {
  serverNowMs: 100,
  tables: [
    {
      id: 'table-1',
      name: 'Bàn 1',
      status: 'OCCUPIED',
      version: 2,
      areaId: 'area-1',
      areaName: 'A',
      areaSortOrder: 0,
      sortOrder: 0,
      activeOrderId: 'order-1',
      occupiedSince: 1,
    },
  ],
  orders: [
    {
      id: 'order-1',
      displayCode: 'D1',
      orderType: 'DINE_IN',
      status: 'OPEN',
      version: 2,
      openedAt: 1,
      itemCount: 1,
      totalVnd: 10_000,
    },
  ],
};

describe('POS overview realtime delta', () => {
  it('merges a consecutive authoritative order and table version', () => {
    const result = mergePosOverviewDelta(base, {
      serverNowMs: 200,
      order: { ...base.orders[0]!, version: 3, totalVnd: 20_000 },
      tables: [{ ...base.tables[0]!, version: 3, totalVnd: 20_000 }],
    });
    expect(result.complete).toBe(true);
    expect(result.snapshot?.orders[0]).toMatchObject({ version: 3, totalVnd: 20_000 });
    expect(result.snapshot?.tables[0]).toMatchObject({ version: 3, totalVnd: 20_000 });
  });

  it('falls back when an order version jumps', () => {
    const result = mergePosOverviewDelta(base, {
      serverNowMs: 200,
      order: { ...base.orders[0]!, version: 5 },
    });
    expect(result.complete).toBe(false);
    expect(result.snapshot).toBe(base);
  });

  it('removes a closed order and applies the released table', () => {
    const result = mergePosOverviewDelta(base, {
      serverNowMs: 200,
      closedOrderId: 'order-1',
      tables: [
        {
          ...base.tables[0]!,
          status: 'AVAILABLE',
          version: 3,
          activeOrderId: null,
          occupiedSince: null,
        },
      ],
    });
    expect(result.complete).toBe(true);
    expect(result.snapshot?.orders).toEqual([]);
    expect(result.snapshot?.tables[0]).toMatchObject({ status: 'AVAILABLE', version: 3 });
  });
});
