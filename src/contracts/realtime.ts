import type { PrintJob } from './print-job';

export const REALTIME_SUBPROTOCOL = 'propos.realtime.v1';
export const REALTIME_SCHEMA_VERSION = 1 as const;
export const REALTIME_REPLAY_LIMIT = 500;

export type PosRealtimeTopic =
  | 'pos.orders'
  | 'pos.tables'
  | 'pos.print_jobs'
  | 'pos.print_config'
  | 'guest.orders'
  | 'guest.services'
  | 'guest.table-open-requests'
  | `pos.order:${string}`
  | `pos.print_job:${string}`;

export type PosRealtimeReason =
  | 'CREATED'
  | 'ITEM_ADDED'
  | 'ITEM_UPDATED'
  | 'ITEM_REMOVED'
  | 'BATCH_SAVED'
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
  | 'DELETED'
  | 'GUEST_ORDER_CREATED'
  | 'GUEST_ORDER_ACCEPTED'
  | 'GUEST_ORDER_REJECTED'
  | 'SERVICE_REQUEST_CREATED'
  | 'SERVICE_REQUEST_UPDATED'
  | 'TABLE_OPEN_REQUEST_CREATED'
  | 'TABLE_OPEN_REQUEST_UPDATED'
  | 'PRINT_JOB_CREATED'
  | 'PRINT_JOB_UPDATED'
  | 'PRINT_JOB_CLAIMED'
  | 'PRINT_JOB_STARTED'
  | 'PRINT_JOB_COMPLETED'
  | 'PRINT_JOB_FAILED'
  | 'PRINT_JOB_UNCERTAIN'
  | 'PRINT_CONFIG_UPDATED';

export interface RealtimeEventV1 {
  schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  eventId: string;
  sequence: number;
  type:
    | 'pos.order.created'
    | 'pos.order.changed'
    | 'pos.order.closed'
    | 'pos.print_job.created'
    | 'pos.print_job.updated'
    | 'pos.print_config.updated';
  storeId: string;
  aggregate: {
    type: 'ORDER' | 'PRINT_JOB' | 'STORE';
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
    guestRequestId?: string;
    serviceRequestId?: string;
    serviceRequestType?: 'CALL_STAFF' | 'CHECKOUT_REQUEST';
    tableOpenRequestId?: string;
    tableOpenRequestStatus?: 'OPEN' | 'COMPLETED' | 'CANCELLED';
    printJobId?: string;
    printJobStatus?:
      'QUEUED' | 'CLAIMED' | 'PRINTING' | 'COMPLETED' | 'FAILED' | 'UNCERTAIN' | 'CANCELLED';
    targetDeviceId?: string | null;
    printerRole?: string;
    documentType?: string;
    documentId?: string;
    claimedByDeviceId?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    printJob?: PrintJob;
    configVersion?: number;
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
      sync?: RealtimeSyncResponse;
    }
  | { type: 'events'; events: RealtimeEventV1[] }
  | { type: 'error'; code: string; message: string };
