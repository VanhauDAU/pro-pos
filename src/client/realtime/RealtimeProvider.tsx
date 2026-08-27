import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { apiRequest } from '@client/lib/api';
import {
  pollingIntervalForRealtime,
  PosRealtimeClient,
  type RealtimeConnectionStatus,
} from './client';
import type { RealtimeEventV1 } from '@contracts/realtime';

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

type RealtimeCoordinatorMessage =
  | { type: 'STATUS'; status: RealtimeConnectionStatus }
  | { type: 'SERVER_TIME'; offsetMs: number }
  | { type: 'EVENTS'; events: RealtimeEventV1[] };

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeConnectionStatus>('DISABLED');
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const context = useQuery({
    queryKey: ['pos-context'],
    queryFn: () => apiRequest<RealtimeStaffContext>('/api/v1/pos/context'),
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const enabled =
    context.data?.capabilities?.posRealtime !== false && Boolean(context.data?.storeId);
  const storeId = context.data?.storeId;

  useEffect(() => {
    if (!enabled || !storeId) {
      setStatus('DISABLED');
      return undefined;
    }
    const tabId = crypto.randomUUID();
    const channelName = `propos:realtime:${storeId}`;
    const leaseKey = `${channelName}:lease`;
    const messageKey = `${channelName}:message`;
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelName);
    let leader = false;
    let stopped = false;

    const post = (message: RealtimeCoordinatorMessage) => {
      // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin parameter.
      channel?.postMessage(message);
      try {
        localStorage.setItem(
          messageKey,
          JSON.stringify({ source: tabId, nonce: crypto.randomUUID(), message }),
        );
      } catch {
        // BroadcastChannel remains the primary transport.
      }
    };

    const client = new PosRealtimeClient(
      storeId,
      queryClient,
      (nextStatus) => {
        if (!leader) return;
        setStatus(nextStatus);
        post({ type: 'STATUS', status: nextStatus });
      },
      (offsetMs) => {
        if (!leader) return;
        setServerTimeOffsetMs(offsetMs);
        post({ type: 'SERVER_TIME', offsetMs });
      },
      (events) => {
        if (leader) post({ type: 'EVENTS', events });
      },
    );

    const receive = (message: RealtimeCoordinatorMessage) => {
      if (leader) return;
      if (message.type === 'STATUS') setStatus(message.status);
      if (message.type === 'SERVER_TIME') setServerTimeOffsetMs(message.offsetMs);
      if (message.type === 'EVENTS') client.receiveBroadcastEvents(message.events);
    };

    const onChannelMessage = (event: MessageEvent<RealtimeCoordinatorMessage>) => {
      receive(event.data);
    };
    channel?.addEventListener('message', onChannelMessage);

    const readLease = () => {
      try {
        return JSON.parse(localStorage.getItem(leaseKey) ?? 'null') as {
          owner: string;
          expiresAt: number;
        } | null;
      } catch {
        return null;
      }
    };

    const coordinate = () => {
      if (stopped) return;
      const now = Date.now();
      const current = readLease();
      if (!current || current.owner === tabId || current.expiresAt <= now) {
        try {
          localStorage.setItem(leaseKey, JSON.stringify({ owner: tabId, expiresAt: now + 12_000 }));
        } catch {
          if (!leader) {
            leader = true;
            client.start();
          }
          return;
        }
      }
      const confirmed = readLease();
      const shouldLead = confirmed?.owner === tabId;
      if (shouldLead && !leader) {
        leader = true;
        client.start();
      } else if (!shouldLead && leader) {
        leader = false;
        client.stop('RECONNECTING');
      } else if (!shouldLead) {
        setStatus((currentStatus) => (currentStatus === 'DISABLED' ? 'CONNECTING' : currentStatus));
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === leaseKey) coordinate();
      if (event.key !== messageKey || !event.newValue) return;
      try {
        const envelope = JSON.parse(event.newValue) as {
          source: string;
          message: RealtimeCoordinatorMessage;
        };
        if (envelope.source !== tabId) receive(envelope.message);
      } catch {
        // Ignore malformed cross-tab messages.
      }
    };
    window.addEventListener('storage', onStorage);
    coordinate();
    const heartbeat = window.setInterval(coordinate, 4_000);

    return () => {
      stopped = true;
      window.clearInterval(heartbeat);
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onChannelMessage);
      channel?.close();
      const current = readLease();
      if (current?.owner === tabId) localStorage.removeItem(leaseKey);
      leader = false;
      client.stop();
    };
  }, [enabled, queryClient, storeId]);

  const value = useMemo(() => ({ status, serverTimeOffsetMs }), [serverTimeOffsetMs, status]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function usePosPollingInterval(fallbackMs: number): number | false {
  const { status } = useRealtime();
  return pollingIntervalForRealtime(status, fallbackMs);
}
