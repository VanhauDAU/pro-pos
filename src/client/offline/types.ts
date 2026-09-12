import type { AppBootstrapResponse } from '@contracts/app-bootstrap';
import type { PosOverviewSnapshot } from '@contracts/pos';

export const POS_LOCAL_DB_NAME = 'propos-pos-offline';
export const POS_LOCAL_DB_VERSION = 1;

export type PosSnapshotKind = 'BOOTSTRAP' | 'OVERVIEW' | 'CATALOG' | 'ORDER_QUOTE';

export interface PosLocalSnapshot<T = unknown> {
  key: string;
  storeId: string;
  kind: PosSnapshotKind;
  entityId: string;
  value: T;
  serverVersion: number | null;
  updatedAt: number;
}

export type PosCommandStatus =
  | 'PENDING'
  | 'SYNCING'
  | 'ACKNOWLEDGED'
  | 'CONFLICT'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'AUTH_REQUIRED';

export type PosOfflineCommandType =
  | 'OPEN_ORDER'
  | 'SAVE_ORDER'
  | 'UPDATE_NOTE'
  | 'PAUSE_TIME'
  | 'RESUME_TIME'
  | 'UPDATE_TIME_RANGE'
  | 'REMOVE_TIME'
  | 'STOP_TIME'
  | 'CANCEL_ORDER'
  | 'CASH_CHECKOUT';

export interface PosCommandBaseQuote {
  order: {
    id: string;
    status: string;
    version: number;
    note?: string | null;
    guestCount?: number;
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    tableName?: string | null;
    tableId?: string | null;
    orderType?: string;
  };
  items: Array<{
    id: string;
    quantityMilli: number;
    variantId?: string | null;
    unitPriceVnd?: number;
    note?: string | null;
    discountType?: string | null;
    discountInputValue?: number | null;
    discountReason?: string | null;
    productId?: string;
    productName?: string;
    variantName?: string | null;
    grossLineTotalVnd?: number;
    discountAmountVnd?: number;
    netLineTotalVnd?: number;
  }>;
  time?: {
    status: string;
    startedAtMs: number;
    endedAtMs: number | null;
  } | null;
  totalVnd?: number;
  promotions?: Array<{ id: string }>;
}

export interface PosQueuedCommand {
  id: string;
  requestId: string;
  storeId: string;
  deviceId: string;
  actorUserId: string;
  type: PosOfflineCommandType;
  orderId: string;
  localOrderId: string | null;
  sequence: number;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: Record<string, unknown>;
  baseOrderVersion: number | null;
  baseQuote: PosCommandBaseQuote | null;
  issuedAt: number;
  createdAt: number;
  status: PosCommandStatus;
  retryCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  acknowledgedAt: number | null;
  authoritativeOrderId: string | null;
  response: unknown | null;
  terminal: boolean;
}

export interface PosConflictRecord {
  id: string;
  commandId: string;
  storeId: string;
  orderId: string;
  type: 'BUSINESS_CONFLICT' | 'TERMINAL_CONFLICT' | 'OPEN_TABLE_CONFLICT';
  reason: string;
  localIntent: unknown;
  serverState: unknown;
  createdAt: number;
  resolvedAt: number | null;
}

export interface PosDraftRecord<T = unknown> {
  key: string;
  storeId: string;
  orderId: string;
  value: T;
  localRevision: number;
  updatedAt: number;
}

export interface PosOfflineStatus {
  reachable: boolean | null;
  syncing: boolean;
  pendingCount: number;
  conflictCount: number;
  authRequired: boolean;
  lastSyncedAt: number | null;
  pendingOrderIds: string[];
}

export interface PosHydrationResult {
  bootstrap: AppBootstrapResponse | null;
  overview: PosOverviewSnapshot | null;
  catalog: unknown[] | null;
  orderQuotes: Array<{ orderId: string; value: unknown }>;
}
