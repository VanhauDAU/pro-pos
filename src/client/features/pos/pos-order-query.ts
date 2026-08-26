import { queryOptions } from '@tanstack/react-query';

import { apiRequest } from '@client/lib/api';
export type RealtimeConnectionStatus = 'DISABLED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export const RUNNING_SERVER_REFRESH_MS = 15_000;
export const QUOTE_DISCONNECTED_REFRESH_MS = 5_000;
export const OVERVIEW_DISCONNECTED_REFRESH_MS = 20_000;

export interface RefreshableOrderQuote {
  order: {
    id: string;
    status: string;
    version: number;
  };
  time?: {
    status: string;
  } | null;
}

export function quoteRefreshInterval(
  quote: RefreshableOrderQuote | undefined,
  realtimeStatus: RealtimeConnectionStatus,
): number | false {
  if (quote?.order.status === 'PAYMENT_PENDING') return false;
  if (quote?.time?.status === 'RUNNING') return RUNNING_SERVER_REFRESH_MS;
  return realtimeStatus === 'CONNECTED' ? false : QUOTE_DISCONNECTED_REFRESH_MS;
}

export function overviewRefreshInterval(
  hasRunningTable: boolean,
  realtimeStatus: RealtimeConnectionStatus,
): number | false {
  if (hasRunningTable) return RUNNING_SERVER_REFRESH_MS;
  return realtimeStatus === 'CONNECTED' ? false : OVERVIEW_DISCONNECTED_REFRESH_MS;
}

type QuoteFetcher<T> = (path: string, signal: AbortSignal | undefined) => Promise<T>;

export function orderQuoteQueryOptions<T extends RefreshableOrderQuote>(input: {
  orderId: string;
  enabled: boolean;
  realtimeStatus: RealtimeConnectionStatus;
  fetcher?: QuoteFetcher<T>;
}) {
  const fetcher =
    input.fetcher ??
    ((path: string, signal: AbortSignal | undefined) =>
      apiRequest<T>(path, signal ? { signal } : undefined));
  return queryOptions({
    queryKey: ['pos-order-quote', input.orderId] as const,
    queryFn: ({ signal }) => fetcher(`/api/v1/pos/orders/${input.orderId}/quote`, signal),
    enabled: input.enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => quoteRefreshInterval(query.state.data, input.realtimeStatus),
  });
}
