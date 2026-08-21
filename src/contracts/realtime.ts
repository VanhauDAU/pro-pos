export const REALTIME_SUBPROTOCOL = 'propos.realtime.v1';
export const REALTIME_SCHEMA_VERSION = 1 as const;
export const REALTIME_REPLAY_LIMIT = 500;

export type PosRealtimeTopic = 'pos.orders' | 'pos.tables' | `pos.order:${string}`;

export type PosRealtimeReason =
  | 'CREATED'
  | 'ITEM_ADDED'
  | 'ITEM_UPDATED'
  | 'ITEM_REMOVED'
  | 'NOTE_UPDATED'
  | 'GUEST_UPDATED'
  | 'TIME_PAUSED'
  | 'TIME_RESUMED'
  | 'TIME_RANGE_UPDATED'
  | 'TIME_REMOVED'
  | 'TIME_STOPPED'
  | 'CHECKOUT_RESUMED'
  | 'TABLE_TRANSFERRED'
  | 'CHECKOUT_COMPLETED'
  | 'CANCELLED'
  | 'DELETED';

export interface RealtimeEventV1 {
  schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  eventId: string;
  sequence: number;
  type: 'pos.order.created' | 'pos.order.changed' | 'pos.order.closed';
  storeId: string;
  aggregate: {
    type: 'ORDER';
    id: string;
    version: number;
  };
  occurredAtMs: number;
  actor: { kind: 'OWNER' | 'EMPLOYEE'; id: string } | null;
  deviceId: string | null;
  clientMutationId: string | null;
  topics: PosRealtimeTopic[];
  data: {
    reason: PosRealtimeReason;
    affectedTableIds?: string[];
  };
}

export type RealtimeSyncResponse =
  | {
      mode: 'REPLAY';
      fromSequence: number;
      toSequence: number;
      serverNowMs: number;
      events: RealtimeEventV1[];
    }
  | {
      mode: 'FULL_SYNC';
      cursor: number;
      serverNowMs: number;
      reason: 'NO_CURSOR' | 'CURSOR_EXPIRED' | 'TOO_MANY_EVENTS' | 'CURSOR_AHEAD';
    };

export type RealtimeServerFrame =
  | {
      type: 'ready';
      connectionId: string;
      serverNowMs: number;
      reauthAtMs: number;
      schemaVersion: typeof REALTIME_SCHEMA_VERSION;
    }
  | { type: 'events'; events: RealtimeEventV1[] }
  | { type: 'error'; code: string; message: string };
