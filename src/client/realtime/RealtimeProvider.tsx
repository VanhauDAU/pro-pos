import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { apiRequest } from '@client/lib/api';
import { playPosSound } from '@client/lib/sound';
import { PosRealtimeClient, type RealtimeConnectionStatus } from './client';

interface RealtimeStaffContext {
  storeId: string;
  capabilities?: { posRealtime?: boolean };
}

interface RealtimeContextValue {
  status: RealtimeConnectionStatus;
  serverTimeOffsetMs: number;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'DISABLED',
  serverTimeOffsetMs: 0,
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeConnectionStatus>('DISABLED');
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<RealtimeStaffContext>('/api/v1/pos/context'),
    refetchInterval: 60_000,
  });
  const enabled = Boolean(context.data?.capabilities?.posRealtime);
  const storeId = context.data?.storeId;

  useEffect(() => {
    if (!enabled || !storeId) {
      setStatus('DISABLED');
      return undefined;
    }
    const client = new PosRealtimeClient(storeId, queryClient, setStatus, setServerTimeOffsetMs);
    client.start();
    return () => client.stop();
  }, [enabled, queryClient, storeId]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as { type?: unknown; soundType?: unknown; tag?: unknown };
      if (
        message.type !== 'PUSH_NOTIFICATION_RECEIVED' ||
        (message.soundType !== 'NEW_QR_ORDER' &&
          message.soundType !== 'CHECKOUT_REQUEST' &&
          message.soundType !== 'TABLE_OPEN_REQUEST' &&
          message.soundType !== 'PAYMENT_SUCCESS')
      ) {
        return;
      }
      playPosSound(message.soundType, typeof message.tag === 'string' ? message.tag : undefined);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const value = useMemo(() => ({ status, serverTimeOffsetMs }), [serverTimeOffsetMs, status]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function usePosPollingInterval(fallbackMs: number): number | false {
  const { status } = useRealtime();
  if (status === 'CONNECTED') return 60_000;
  return fallbackMs;
}
