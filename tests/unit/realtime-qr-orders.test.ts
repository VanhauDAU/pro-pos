import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeEventV1 } from '@contracts/realtime';
import { pollingIntervalForRealtime, PosRealtimeClient } from '@client/realtime/client';

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function guestOrderEvent(
  reason: 'GUEST_ORDER_CREATED' | 'GUEST_ORDER_ACCEPTED' | 'GUEST_ORDER_REJECTED',
): RealtimeEventV1 {
  return {
    schemaVersion: 1,
    eventId: 'qr-event-1',
    sequence: 1,
    type: 'pos.order.changed',
    storeId: 'store-1',
    aggregate: { type: 'ORDER', id: 'order-1', version: 2 },
    occurredAtMs: Date.now(),
    actor: null,
    deviceId: null,
    clientMutationId: null,
    topics: ['guest.orders'],
    data: { reason, guestRequestId: 'guest-request-1' },
  };
}

describe('QR order realtime refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    vi.stubGlobal('sessionStorage', createSessionStorage());
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls only while realtime is not connected', () => {
    expect(pollingIntervalForRealtime('CONNECTED', 5000)).toBe(false);
    expect(pollingIntervalForRealtime('RECONNECTING', 5000)).toBe(5000);
    expect(pollingIntervalForRealtime('CONNECTING', 5000)).toBe(5000);
    expect(pollingIntervalForRealtime('DISABLED', 5000)).toBe(5000);
  });

  it.each(['GUEST_ORDER_CREATED', 'GUEST_ORDER_ACCEPTED', 'GUEST_ORDER_REJECTED'] as const)(
    'invalidates the modal list and badge for %s',
    async (reason) => {
      const queryClient = new QueryClient();
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
      const client = new PosRealtimeClient('store-1', queryClient, vi.fn(), vi.fn());

      client.receiveBroadcastEvents([guestOrderEvent(reason)]);
      await vi.runAllTimersAsync();

      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['pos-staff-all-qr-orders'],
        refetchType: 'active',
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['pos-notification-summary'],
        refetchType: 'active',
      });
    },
  );

  it('includes the modal list in a reconnect full sync', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const client = new PosRealtimeClient('store-1', queryClient, vi.fn(), vi.fn());

    await (
      client as unknown as {
        fullSync: () => Promise<void>;
      }
    ).fullSync();

    const filters = invalidate.mock.calls[0]?.[0];
    expect(
      filters?.predicate?.({
        queryKey: ['pos-staff-all-qr-orders'],
        state: { dataUpdatedAt: 0 },
      } as never),
    ).toBe(true);
  });
});
