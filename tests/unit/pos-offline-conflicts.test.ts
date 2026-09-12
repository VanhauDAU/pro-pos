import { describe, expect, it } from 'vitest';

import { resolvePosVersionConflict } from '@client/offline/conflict-resolver';
import type { PosCommandBaseQuote, PosQueuedCommand } from '@client/offline/types';

describe('Offline Conflict Resolution Matrix (7 Specification Cases)', () => {
  function makeBaseQuote(overrides: Partial<PosCommandBaseQuote> = {}): PosCommandBaseQuote {
    return {
      order: {
        id: 'order-1',
        version: 1,
        status: 'OPEN',
        orderType: 'DINE_IN',
        tableName: 'Bàn 1',
        tableId: 'table-1',
        note: null,
      },
      items: [
        {
          id: 'item-1',
          productId: 'prod-1',
          variantId: 'var-1',
          productName: 'Cà phê đen',
          variantName: null,
          unitPriceVnd: 25000,
          quantityMilli: 1000,
          grossLineTotalVnd: 25000,
          discountAmountVnd: 0,
          netLineTotalVnd: 25000,
          note: null,
          discountType: null,
          discountInputValue: null,
          discountReason: null,
        },
      ],
      totalVnd: 25000,
      time: null,
      promotions: [],
      ...overrides,
    };
  }

  function makeCommand(overrides: Partial<PosQueuedCommand> = {}): PosQueuedCommand {
    const now = Date.now();
    return {
      sequence: overrides.sequence ?? 1,
      id: 'cmd-1',
      requestId: 'req-1',
      storeId: 'store-1',
      deviceId: 'dev-1',
      actorUserId: 'user-1',
      type: 'SAVE_ORDER',
      orderId: 'order-1',
      localOrderId: null,
      method: 'POST',
      path: '/api/v1/pos/orders/order-1/save',
      body: { expectedOrderVersion: 1 },
      baseOrderVersion: 1,
      baseQuote: makeBaseQuote(),
      issuedAt: now,
      createdAt: now,
      status: 'PENDING',
      retryCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      acknowledgedAt: null,
      authoritativeOrderId: null,
      response: null,
      terminal: false,
      ...overrides,
    };
  }

  it('Case 1: Independent item adds -> Auto-rebase without conflict', () => {
    const base = makeBaseQuote();
    const serverQuote = makeBaseQuote({
      order: { ...base.order, version: 2 },
      items: [
        ...base.items,
        {
          id: 'item-coca',
          productId: 'prod-coca',
          variantId: null,
          productName: 'Coca Cola',
          variantName: null,
          unitPriceVnd: 15000,
          quantityMilli: 1000,
          grossLineTotalVnd: 15000,
          discountAmountVnd: 0,
          netLineTotalVnd: 15000,
          note: null,
          discountType: null,
          discountInputValue: null,
          discountReason: null,
        },
      ],
      totalVnd: 40000,
    });

    const command = makeCommand({
      baseQuote: base,
      body: {
        expectedOrderVersion: 1,
        addedItems: [{ productId: 'prod-tiger', quantityMilli: 1000 }],
        updatedItems: [],
      },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('REBASE');
    if (resolution.action === 'REBASE') {
      expect(resolution.body.expectedOrderVersion).toBe(2);
    }
  });

  it('Case 2: Concurrent update on same item -> BUSINESS_CONFLICT', () => {
    const base = makeBaseQuote();
    const serverQuote = makeBaseQuote({
      order: { ...base.order, version: 2 },
      items: [
        {
          ...base.items[0]!,
          quantityMilli: 2000,
          grossLineTotalVnd: 50000,
          netLineTotalVnd: 50000,
        },
      ],
      totalVnd: 50000,
    });

    const command = makeCommand({
      baseQuote: base,
      body: {
        expectedOrderVersion: 1,
        addedItems: [],
        updatedItems: [{ itemId: 'item-1', quantityMilli: 3000 }],
      },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('CONFLICT');
    if (resolution.action === 'CONFLICT') {
      expect(resolution.conflictType).toBe('BUSINESS_CONFLICT');
      expect(resolution.reason).toContain('sửa trên thiết bị khác');
    }
  });

  it('Case 3: Add item vs remote order cancellation -> TERMINAL_CONFLICT', () => {
    const base = makeBaseQuote();
    const serverQuote = makeBaseQuote({
      order: { ...base.order, status: 'CANCELLED', version: 2 },
    });

    const command = makeCommand({
      baseQuote: base,
      body: {
        expectedOrderVersion: 1,
        addedItems: [{ productId: 'prod-2', quantityMilli: 1000 }],
      },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('CONFLICT');
    if (resolution.action === 'CONFLICT') {
      expect(resolution.conflictType).toBe('TERMINAL_CONFLICT');
      expect(resolution.reason).toContain('hủy trên thiết bị khác');
    }
  });

  it('Case 4: Concurrent time adjustments -> BUSINESS_CONFLICT', () => {
    const base = makeBaseQuote({
      time: {
        status: 'RUNNING',
        startedAtMs: 1000000,
        endedAtMs: null,
      },
    });

    const serverQuote = makeBaseQuote({
      order: { ...base.order, version: 2 },
      time: {
        status: 'PAUSED',
        startedAtMs: 1000000,
        endedAtMs: 1050000,
      },
    });

    const command = makeCommand({
      type: 'PAUSE_TIME',
      baseQuote: base,
      body: { expectedOrderVersion: 1 },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('CONFLICT');
    if (resolution.action === 'CONFLICT') {
      expect(resolution.conflictType).toBe('BUSINESS_CONFLICT');
      expect(resolution.reason).toContain('Phiên tính giờ');
    }
  });

  it('Case 5: Checkout vs remote checkout -> TERMINAL_CONFLICT', () => {
    const base = makeBaseQuote();
    const serverQuote = makeBaseQuote({
      order: { ...base.order, status: 'PAID', version: 2 },
    });

    const command = makeCommand({
      type: 'CASH_CHECKOUT',
      terminal: true,
      baseQuote: base,
      body: { expectedOrderVersion: 1, expectedTotalVnd: 25000, method: 'CASH' },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('CONFLICT');
    if (resolution.action === 'CONFLICT') {
      expect(resolution.conflictType).toBe('TERMINAL_CONFLICT');
      expect(resolution.reason).toContain('thanh toán trên thiết bị khác');
    }
  });

  it('Case 6: Cash checkout with total mismatch -> BUSINESS_CONFLICT with financial difference', () => {
    const base = makeBaseQuote();
    const serverQuote = makeBaseQuote({
      order: { ...base.order, version: 2 },
      totalVnd: 50000,
    });

    const command = makeCommand({
      type: 'CASH_CHECKOUT',
      terminal: true,
      baseQuote: base,
      body: { expectedOrderVersion: 1, expectedTotalVnd: 25000, method: 'CASH' },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('CONFLICT');
    if (resolution.action === 'CONFLICT') {
      expect(resolution.conflictType).toBe('BUSINESS_CONFLICT');
      expect(resolution.reason).toContain('25000');
      expect(resolution.reason).toContain('50000');
    }
  });

  it('Case 7: Open table vs remote open table -> OPEN_TABLE_CONFLICT', () => {
    const serverQuote = makeBaseQuote({
      order: { id: 'remote-order-99', version: 1, status: 'OPEN', orderType: 'DINE_IN', tableId: 'table-1' },
    });

    const command = makeCommand({
      type: 'OPEN_ORDER',
      baseQuote: null,
      body: { tableId: 'table-1', expectedTableVersion: 1 },
    });

    const resolution = resolvePosVersionConflict(command, serverQuote);
    expect(resolution.action).toBe('CONFLICT');
    if (resolution.action === 'CONFLICT') {
      expect(resolution.conflictType).toBe('OPEN_TABLE_CONFLICT');
      expect(resolution.reason).toContain('Bàn đã được mở');
    }
  });
});
