import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  OVERVIEW_DISCONNECTED_REFRESH_MS,
  QUOTE_DISCONNECTED_REFRESH_MS,
  RUNNING_SERVER_REFRESH_MS,
  orderQuoteQueryOptions,
  overviewRefreshInterval,
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

  it('polls only running quotes while realtime is connected', () => {
    expect(quoteRefreshInterval(quote(1, 'OPEN', 'RUNNING'), 'CONNECTED')).toBe(
      RUNNING_SERVER_REFRESH_MS,
    );
    expect(quoteRefreshInterval(quote(1, 'OPEN', 'PAUSED'), 'CONNECTED')).toBe(false);
    expect(quoteRefreshInterval(quote(1, 'PAYMENT_PENDING', 'RUNNING'), 'RECONNECTING')).toBe(
      false,
    );
    expect(quoteRefreshInterval(quote(1), 'RECONNECTING')).toBe(QUOTE_DISCONNECTED_REFRESH_MS);
  });

  it('polls overview every 15 seconds only for a running table when connected', () => {
    expect(overviewRefreshInterval(true, 'CONNECTED')).toBe(RUNNING_SERVER_REFRESH_MS);
    expect(overviewRefreshInterval(false, 'CONNECTED')).toBe(false);
    expect(overviewRefreshInterval(false, 'RECONNECTING')).toBe(OVERVIEW_DISCONNECTED_REFRESH_MS);
  });
});
