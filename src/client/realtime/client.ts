import type { QueryClient } from '@tanstack/react-query';

import {
  REALTIME_SCHEMA_VERSION,
  REALTIME_SUBPROTOCOL,
  type RealtimeEventV1,
  type RealtimeServerFrame,
  type RealtimeSyncResponse,
} from '@contracts/realtime';
import { apiRequest } from '@client/lib/api';

export type RealtimeConnectionStatus = 'DISABLED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

function logRealtime(
  level: 'info' | 'warn',
  event: string,
  details: Record<string, string | number | boolean | null>,
) {
  console[level]('[POS realtime]', { event, ...details });
}

export class PosRealtimeClient {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private reauthTimer: number | null = null;
  private pingTimer: number | null = null;
  private invalidationTimer: number | null = null;
  private readonly pendingTopics = new Set<string>();
  private readonly pendingOrderIds = new Set<string>();
  private syncing = false;
  private eventQueue: Promise<void> = Promise.resolve();
  private bufferedEvents: RealtimeEventV1[] = [];
  private readonly seenEventIds = new Set<string>();
  private cursor: number | null;

  private serverTimeOffset = 0;

  constructor(
    private readonly storeId: string,
    private readonly queryClient: QueryClient,
    private readonly onStatus: (status: RealtimeConnectionStatus) => void,
    private readonly onServerTime: (offsetMs: number) => void,
    private readonly onEvents?: (events: RealtimeEventV1[]) => void,
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
    this.connect(false);
  }

  stop(status: RealtimeConnectionStatus = 'DISABLED') {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000, 'Realtime client stopped');
    this.socket = null;
    this.onStatus(status);
  }

  private clearTimers() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.reauthTimer !== null) window.clearTimeout(this.reauthTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    if (this.invalidationTimer !== null) window.clearTimeout(this.invalidationTimer);
    this.reconnectTimer = null;
    this.reauthTimer = null;
    this.pingTimer = null;
    this.invalidationTimer = null;
  }

  private connect(reconnecting: boolean) {
    if (this.stopped) return;
    this.clearTimers();
    this.socket?.close();
    this.onStatus(reconnecting ? 'RECONNECTING' : 'CONNECTING');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL('/api/v1/pos/realtime/stream', window.location.origin);
    url.protocol = protocol;
    url.searchParams.set('clientVersion', 'web-v1');
    if (this.cursor !== null) url.searchParams.set('after', String(this.cursor));
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
        if (frame.schemaVersion !== REALTIME_SCHEMA_VERSION) {
          socket.close(4406, 'Realtime schema mismatch');
          return;
        }
        this.serverTimeOffset = frame.serverNowMs - Date.now();
        this.onServerTime(this.serverTimeOffset);
        const reconnectIn = Math.max(1_000, frame.reauthAtMs - Date.now() - 5_000);
        this.reauthTimer = window.setTimeout(() => this.connect(true), reconnectIn);
        this.pingTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
        }, 25_000);
        void this.synchronize(frame.sync);
        return;
      }
      if (frame.type === 'events') this.enqueueEvents(frame.events, socket);
    });

    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      logRealtime('warn', 'connection_closed', {
        code: event.code,
        clean: event.wasClean,
        reconnectAttempt: this.reconnectAttempt + 1,
      });
      this.scheduleReconnect(event.code === 4401 ? 250 : undefined);
    });
    socket.addEventListener('error', () => socket.close());
  }

  private enqueueEvents(events: RealtimeEventV1[], socket: WebSocket) {
    this.onEvents?.(events);
    this.eventQueue = this.eventQueue
      .then(() => this.receiveEvents(events))
      .catch(() => {
        if (this.socket === socket) socket.close(1012, 'Realtime event processing failed');
      });
  }

  receiveBroadcastEvents(events: RealtimeEventV1[]) {
    this.eventQueue = this.eventQueue.then(() => this.receiveEvents(events)).catch(() => undefined);
  }

  private scheduleReconnect(delayOverride?: number) {
    if (this.stopped || this.reconnectTimer !== null) return;
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
      this.routeEvent(event, true);
      this.advanceCursor(event.sequence, event.eventId);
      return processAt(index + 1);
    };
    await processAt(0);
  }

  private async synchronize(initialResponse?: RealtimeSyncResponse) {
    if (this.syncing || this.stopped) return;
    this.syncing = true;
    try {
      const response =
        initialResponse ??
        (await apiRequest<RealtimeSyncResponse>(
          `/api/v1/pos/realtime/sync${this.cursor === null ? '' : `?after=${this.cursor}`}`,
        ));
      this.serverTimeOffset = response.serverNowMs - Date.now();
      this.onServerTime(this.serverTimeOffset);
      if (response.mode === 'FULL_SYNC') {
        logRealtime('info', 'full_sync', {
          reason: response.reason,
          cursor: response.cursor,
        });
        await this.fullSync();
        this.setCursor(response.cursor);
      } else {
        logRealtime('info', 'replay', {
          fromSequence: response.fromSequence,
          toSequence: response.toSequence,
          events: response.events.length,
        });
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
      const isRecent = Date.now() + this.serverTimeOffset - event.occurredAtMs < 20_000;
      this.routeEvent(event, isRecent);
      this.advanceCursor(event.sequence, event.eventId);
      return processAt(index + 1);
    };
    await processAt(0);
  }

  private isOwnMutation(event: RealtimeEventV1) {
    if (!event.clientMutationId) return false;
    try {
      const recent = JSON.parse(
        sessionStorage.getItem('propos:recent-mutations') ?? '[]',
      ) as Array<{
        id: string;
        at: number;
      }>;
      const now = Date.now();
      return recent.some(
        (item) =>
          now - item.at < 60_000 &&
          (event.clientMutationId === item.id || event.clientMutationId!.startsWith(`${item.id}:`)),
      );
    } catch {
      return false;
    }
  }

  private routeEvent(event: RealtimeEventV1, _isLive: boolean) {
    if (this.isOwnMutation(event)) return;
    for (const topic of event.topics) this.pendingTopics.add(topic);
    if (event.topics.includes(`pos.order:${event.aggregate.id}`)) {
      this.pendingOrderIds.add(event.aggregate.id);
    }
    this.scheduleInvalidationFlush();
  }

  private scheduleInvalidationFlush() {
    if (this.invalidationTimer !== null) return;
    this.invalidationTimer = window.setTimeout(() => {
      this.invalidationTimer = null;
      const topics = new Set(this.pendingTopics);
      const orderIds = [...this.pendingOrderIds];
      this.pendingTopics.clear();
      this.pendingOrderIds.clear();
      const invalidations: Array<Promise<unknown>> = [];
      if (topics.has('pos.tables') || topics.has('pos.orders')) {
        invalidations.push(
          this.queryClient.invalidateQueries({ queryKey: ['pos-overview'], refetchType: 'active' }),
          this.queryClient.invalidateQueries({ queryKey: ['pos-tables'], refetchType: 'active' }),
        );
      }
      if (
        topics.has('guest.orders') ||
        topics.has('guest.services') ||
        topics.has('guest.table-open-requests')
      ) {
        invalidations.push(
          this.queryClient.invalidateQueries({
            queryKey: ['pos-notification-summary'],
            refetchType: 'active',
          }),
        );
      }
      if (
        topics.has('pos.orders') ||
        topics.has('guest.orders') ||
        topics.has('guest.services') ||
        topics.has('guest.table-open-requests')
      ) {
        invalidations.push(
          this.queryClient.invalidateQueries({
            queryKey: ['staff-notification-audit'],
            refetchType: 'active',
          }),
        );
      }
      for (const orderId of orderIds) {
        invalidations.push(
          this.queryClient.invalidateQueries({
            queryKey: ['pos-order-quote', orderId],
            refetchType: 'active',
          }),
          this.queryClient.invalidateQueries({
            queryKey: ['pos-order-detail', orderId],
            refetchType: 'active',
          }),
        );
      }
      void Promise.all(invalidations);
    }, 75);
  }

  private fullSync() {
    return this.queryClient.invalidateQueries({
      predicate: (query) => {
        // Do not immediately invalidate fresh queries that were loaded within the last 10s on initial mount
        if (Date.now() - query.state.dataUpdatedAt < 10_000) {
          return false;
        }
        const root = query.queryKey[0];
        return (
          root === 'pos-tables' ||
          root === 'pos-overview' ||
          root === 'pos-notification-summary' ||
          root === 'pos-order-quote' ||
          root === 'pos-order-detail' ||
          root === 'guest-order-requests' ||
          root === 'service-requests' ||
          root === 'table-open-requests' ||
          root === 'staff-notification-audit'
        );
      },
      refetchType: 'active',
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
