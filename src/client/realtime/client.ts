import type { QueryClient } from '@tanstack/react-query';

import {
  REALTIME_SUBPROTOCOL,
  type RealtimeEventV1,
  type RealtimeServerFrame,
  type RealtimeSyncResponse,
} from '@contracts/realtime';
import { apiRequest } from '@client/lib/api';

export type RealtimeConnectionStatus =
  'DISABLED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

export class PosRealtimeClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private reauthTimer: number | null = null;
  private pingTimer: number | null = null;
  private syncing = false;
  private bufferedEvents: RealtimeEventV1[] = [];
  private readonly seenEventIds = new Set<string>();
  private cursor: number | null;

  constructor(
    private readonly storeId: string,
    private readonly queryClient: QueryClient,
    private readonly onStatus: (status: RealtimeConnectionStatus) => void,
    private readonly onServerTime: (offsetMs: number) => void,
  ) {
    const stored = sessionStorage.getItem(this.cursorKey);
    const parsed = stored === null ? null : Number(stored);
    this.cursor = parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private get cursorKey() {
    return `propos:realtime:${this.storeId}:cursor`;
  }

  start() {
    this.stopped = false;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    if (!navigator.onLine) {
      this.onStatus('OFFLINE');
      return;
    }
    this.connect(false);
  }

  stop(status: RealtimeConnectionStatus = 'DISABLED') {
    this.stopped = true;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.clearTimers();
    this.socket?.close(1000, 'Realtime client stopped');
    this.socket = null;
    this.onStatus(status);
  }

  private readonly handleOnline = () => {
    if (this.stopped) return;
    this.reconnectAttempt = 0;
    this.connect(true);
  };

  private readonly handleOffline = () => {
    this.clearTimers();
    this.socket?.close(1000, 'Browser offline');
    this.socket = null;
    this.onStatus('OFFLINE');
  };

  private clearTimers() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.reauthTimer !== null) window.clearTimeout(this.reauthTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.reauthTimer = null;
    this.pingTimer = null;
  }

  private connect(reconnecting: boolean) {
    if (this.stopped || !navigator.onLine) return;
    this.clearTimers();
    this.socket?.close();
    this.onStatus(reconnecting ? 'RECONNECTING' : 'CONNECTING');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL('/api/v1/pos/realtime/stream', window.location.origin);
    url.protocol = protocol;
    url.searchParams.set('clientVersion', 'web-v1');
    const socket = new WebSocket(url, REALTIME_SUBPROTOCOL);
    this.socket = socket;

    socket.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') return;
      let frame: RealtimeServerFrame | { type: 'pong' };
      try {
        frame = JSON.parse(message.data) as RealtimeServerFrame | { type: 'pong' };
      } catch {
        return;
      }
      if (frame.type === 'ready') {
        this.onServerTime(frame.serverNowMs - Date.now());
        const reconnectIn = Math.max(1_000, frame.reauthAtMs - Date.now() - 5_000);
        this.reauthTimer = window.setTimeout(() => this.connect(true), reconnectIn);
        this.pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
        }, 25_000);
        void this.synchronize();
        return;
      }
      if (frame.type === 'events') void this.receiveEvents(frame.events);
    });

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped || !navigator.onLine) return;
      this.scheduleReconnect(event.code === 4401 ? 250 : undefined);
    });
    socket.addEventListener('error', () => socket.close());
  }

  private scheduleReconnect(delayOverride?: number) {
    if (this.stopped || !navigator.onLine || this.reconnectTimer !== null) return;
    this.onStatus('RECONNECTING');
    const base =
      delayOverride ?? BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)]!;
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(true);
    }, delay);
  }

  private async receiveEvents(events: RealtimeEventV1[]) {
    if (this.syncing) {
      this.bufferedEvents.push(...events);
      return;
    }
    const sorted = events.toSorted((a, b) => a.sequence - b.sequence);
    const processAt = async (index: number): Promise<void> => {
      const event = sorted[index];
      if (!event) return;
      if (
        this.seenEventIds.has(event.eventId) ||
        (this.cursor !== null && event.sequence <= this.cursor)
      ) {
        return processAt(index + 1);
      }
      if (this.cursor !== null && event.sequence > this.cursor + 1) {
        this.bufferedEvents.push(event);
        await this.synchronize();
        return;
      }
      await this.routeEvent(event);
      this.advanceCursor(event.sequence, event.eventId);
      return processAt(index + 1);
    };
    await processAt(0);
  }

  private async synchronize() {
    if (this.syncing || this.stopped) return;
    this.syncing = true;
    try {
      const query = this.cursor === null ? '' : `?after=${this.cursor}`;
      const response = await apiRequest<RealtimeSyncResponse>(`/api/v1/pos/realtime/sync${query}`);
      this.onServerTime(response.serverNowMs - Date.now());
      if (response.mode === 'FULL_SYNC') {
        await this.fullSync();
        this.setCursor(response.cursor);
      } else {
        await this.receiveReplay(response.events);
        this.setCursor(response.toSequence);
      }
      this.reconnectAttempt = 0;
      this.onStatus('CONNECTED');
    } catch {
      this.socket?.close(1012, 'Realtime sync failed');
      return;
    } finally {
      this.syncing = false;
    }

    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    if (buffered.length > 0) await this.receiveEvents(buffered);
  }

  private async receiveReplay(events: RealtimeEventV1[]) {
    const processAt = async (index: number): Promise<void> => {
      const event = events[index];
      if (!event) return;
      if (this.seenEventIds.has(event.eventId)) return processAt(index + 1);
      await this.routeEvent(event);
      this.advanceCursor(event.sequence, event.eventId);
      return processAt(index + 1);
    };
    await processAt(0);
  }

  private async routeEvent(event: RealtimeEventV1) {
    const invalidations: Array<Promise<unknown>> = [];
    if (event.topics.includes('pos.orders')) {
      invalidations.push(this.queryClient.invalidateQueries({ queryKey: ['pos-orders'] }));
    }
    if (event.topics.includes('pos.tables')) {
      invalidations.push(this.queryClient.invalidateQueries({ queryKey: ['pos-tables'] }));
    }
    if (event.topics.includes(`pos.order:${event.aggregate.id}`)) {
      invalidations.push(
        this.queryClient.invalidateQueries({ queryKey: ['pos-order-quote', event.aggregate.id] }),
        this.queryClient.invalidateQueries({ queryKey: ['pos-order-detail', event.aggregate.id] }),
      );
    }
    await Promise.all(invalidations);
  }

  private fullSync() {
    return this.queryClient.invalidateQueries({
      predicate: (query) => {
        const root = query.queryKey[0];
        return (
          root === 'pos-orders' ||
          root === 'pos-tables' ||
          root === 'pos-order-quote' ||
          root === 'pos-order-detail'
        );
      },
    });
  }

  private setCursor(sequence: number) {
    this.cursor = sequence;
    sessionStorage.setItem(this.cursorKey, String(sequence));
  }

  private advanceCursor(sequence: number, eventId: string) {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > 1_000) {
      const oldest = this.seenEventIds.values().next().value as string | undefined;
      if (oldest) this.seenEventIds.delete(oldest);
    }
    this.setCursor(sequence);
  }
}
