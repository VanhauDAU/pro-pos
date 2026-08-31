import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  OVERVIEW_DISCONNECTED_REFRESH_MS,
  QUOTE_INTERACTION_FRESH_MS,
  QUOTE_REALTIME_INTERACTION_FRESH_MS,
  QUOTE_DISCONNECTED_REFRESH_MS,
  CONNECTED_RUNNING_SAFETY_REFRESH_MS,
  orderQuoteQueryOptions,
  overviewRefreshInterval,
  quoteIsVerifiedForInteraction,
  quoteRefreshInterval,
  type RefreshableOrderQuote,
} from '@client/features/pos/pos-order-query';

function quote(version: number, status = 'OPEN', timeStatus: string | null = null) {
  return {
    order: { id: 'order-1', status, version },
    time: timeStatus ? { status: timeStatus } : null,
  } satisfies RefreshableOrderQuote;
}

describe('POS order quote cache policy', () => {
  it('reuses a quote prefetched for the current tap without a duplicate mount request', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn(async (_path: string, _signal: AbortSignal | undefined) => quote(12));
    const options = orderQuoteQueryOptions({
      orderId: 'order-1',
      enabled: true,
      realtimeStatus: 'CONNECTED',
      fetcher,
    });

    await client.prefetchQuery(options);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    unsubscribe();
    client.clear();
  });

  it('refetches an inactive invalidated quote before using it after mount', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn(async () => quote(14));
    const options = orderQuoteQueryOptions({
      orderId: 'order-1',
      enabled: true,
      realtimeStatus: 'CONNECTED',
      fetcher,
    });
    client.setQueryData(options.queryKey, quote(12));

    await client.invalidateQueries({ queryKey: options.queryKey, refetchType: 'active' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.getQueryData<RefreshableOrderQuote>(options.queryKey)?.order.version).toBe(12);

    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(client.getQueryData<RefreshableOrderQuote>(options.queryKey)?.order.version).toBe(14),
    );

    unsubscribe();
    client.clear();
  });

  it('forces a full payment quote after mount even when an editor quote is cached', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const paths: string[] = [];
    const options = orderQuoteQueryOptions({
      orderId: 'order-1',
      enabled: true,
      realtimeStatus: 'CONNECTED',
      projection: 'full',
      requireFreshMount: true,
      fetcher: async (path) => {
        paths.push(path);
        return quote(12);
      },
    });
    client.setQueryData(options.queryKey, quote(12));

    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(paths).toEqual(['/api/v1/pos/orders/order-1/quote']));

    unsubscribe();
    client.clear();
  });

  it('requests the editor projection for intent prefetch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn(async (_path: string, _signal: AbortSignal | undefined) => quote(12));
    await client.prefetchQuery(
      orderQuoteQueryOptions({
        orderId: 'order-1',
        enabled: true,
        realtimeStatus: 'CONNECTED',
        projection: 'editor',
        fetcher,
      }),
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/pos/orders/order-1/quote?projection=editor');
  });

  it('uses a 120-second safety refresh only for running quotes while connected', () => {
    expect(quoteRefreshInterval(quote(1, 'OPEN', 'RUNNING'), 'CONNECTED')).toBe(
      CONNECTED_RUNNING_SAFETY_REFRESH_MS,
    );
    expect(quoteRefreshInterval(quote(1, 'OPEN', 'PAUSED'), 'CONNECTED')).toBe(false);
    expect(quoteRefreshInterval(quote(1, 'PAYMENT_PENDING', 'RUNNING'), 'RECONNECTING')).toBe(
      false,
    );
    for (const status of ['DISABLED', 'CONNECTING', 'RECONNECTING'] as const) {
      expect(quoteRefreshInterval(quote(1, 'OPEN', 'RUNNING'), status)).toBe(
        QUOTE_DISCONNECTED_REFRESH_MS,
      );
      expect(quoteRefreshInterval(quote(1), status)).toBe(QUOTE_DISCONNECTED_REFRESH_MS);
    }
  });

  it('uses a 120-second overview safety refresh for a running table when connected', () => {
    expect(overviewRefreshInterval(true, 'CONNECTED')).toBe(CONNECTED_RUNNING_SAFETY_REFRESH_MS);
    expect(overviewRefreshInterval(false, 'CONNECTED')).toBe(false);
    for (const status of ['DISABLED', 'CONNECTING', 'RECONNECTING'] as const) {
      expect(overviewRefreshInterval(true, status)).toBe(OVERVIEW_DISCONNECTED_REFRESH_MS);
      expect(overviewRefreshInterval(false, status)).toBe(OVERVIEW_DISCONNECTED_REFRESH_MS);
    }
  });

  it('accepts only a fresh, non-stale prefetched quote as interaction-verified', () => {
    const base = {
      orderId: 'order-1',
      quote: quote(12),
      isSuccess: true,
      isFetching: false,
      isRefetchError: false,
      isFetchedAfterMount: false,
      dataUpdatedAt: 10_000,
      realtimeStatus: 'CONNECTED' as const,
      now: 10_000 + QUOTE_REALTIME_INTERACTION_FRESH_MS,
    };

    expect(quoteIsVerifiedForInteraction({ ...base, isStale: false })).toBe(true);
    expect(quoteIsVerifiedForInteraction({ ...base, isStale: true })).toBe(false);
    expect(
      quoteIsVerifiedForInteraction({
        ...base,
        isStale: false,
        now: 10_001 + QUOTE_REALTIME_INTERACTION_FRESH_MS,
      }),
    ).toBe(false);

    expect(
      quoteIsVerifiedForInteraction({
        ...base,
        realtimeStatus: 'RECONNECTING',
        now: 10_000 + QUOTE_INTERACTION_FRESH_MS,
        isStale: false,
      }),
    ).toBe(true);
    expect(
      quoteIsVerifiedForInteraction({
        ...base,
        realtimeStatus: 'RECONNECTING',
        now: 10_001 + QUOTE_INTERACTION_FRESH_MS,
        isStale: false,
      }),
    ).toBe(false);
  });
});
