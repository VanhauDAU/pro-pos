import type { QueryClient } from '@tanstack/react-query';

import type { AuthContextResponse } from '@contracts/auth';
import type { PosOverviewSnapshot, PosStaffContext } from '@contracts/pos';

import { PosLocalRepository } from './repository';
import { HttpPosCommandSender, PosSyncEngine } from './sync-engine';
import type {
  PosCommandBaseQuote,
  PosConflictRecord,
  PosLocalSnapshot,
  PosOfflineCommandType,
  PosOfflineStatus,
  PosQueuedCommand,
} from './types';

const initialStatus: PosOfflineStatus = {
  reachable: null,
  syncing: false,
  pendingCount: 0,
  conflictCount: 0,
  authRequired: false,
  lastSyncedAt: null,
  pendingOrderIds: [],
};

export interface QueuePosMutationInput {
  type: PosOfflineCommandType;
  orderId: string;
  localOrderId?: string | null;
  path: string;
  method?: PosQueuedCommand['method'];
  body: Record<string, unknown>;
  baseQuote?: PosCommandBaseQuote | null;
  terminal?: boolean;
  optimisticQuote?: unknown;
  optimisticOverview?: PosOverviewSnapshot | null | undefined;
}

function extractQuote(response: unknown) {
  if (!response || typeof response !== 'object') return null;
  const record = response as { quote?: unknown };
  return record.quote ?? null;
}

function extractOrderId(response: unknown) {
  if (!response || typeof response !== 'object') return null;
  const record = response as { orderId?: unknown; order?: { id?: unknown } };
  if (typeof record.orderId === 'string') return record.orderId;
  return typeof record.order?.id === 'string' ? record.order.id : null;
}

class PosOfflineRuntime {
  readonly repository = new PosLocalRepository();
  private queryClient: QueryClient | null = null;
  private engine: PosSyncEngine | null = null;
  private storeId: string | null = null;
  private status = initialStatus;
  private readonly listeners = new Set<() => void>();
  private cleanupSignals: (() => void) | null = null;
  private interval: number | null = null;

  initialize(queryClient: QueryClient) {
    this.queryClient = queryClient;
    if (!navigator.onLine) this.setStatus({ ...this.status, reachable: false });
    this.installSignals();
    const context = queryClient.getQueryData<PosStaffContext>(['pos-context']);
    if (context) this.configureStore(context.storeId);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = () => this.status;

  private setStatus(status: PosOfflineStatus) {
    this.status = status;
    for (const listener of this.listeners) listener();
  }

  configureStore(storeId: string) {
    if (!this.queryClient || this.storeId === storeId) return;
    this.engine?.stop();
    this.storeId = storeId;
    const sender = new HttpPosCommandSender(
      () =>
        this.queryClient?.getQueryData<AuthContextResponse>(['auth-context'])?.csrfToken ?? null,
    );
    this.engine = new PosSyncEngine(this.repository, sender, storeId, {
      onStatus: (status) => this.setStatus({ ...this.status, ...status }),
      onAcknowledged: (command, response) => this.applyAcknowledgement(command, response),
      onConflict: (_command, conflict) => this.applyConflict(conflict),
    });
    void this.repository.putMeta('lastStoreId', storeId);
    void this.engine.start();
  }

  async enqueue(input: QueuePosMutationInput): Promise<PosQueuedCommand> {
    if (!this.queryClient) throw new Error('POS offline runtime is not initialized.');
    const auth = this.queryClient.getQueryData<AuthContextResponse>(['auth-context']);
    const context = this.queryClient.getQueryData<PosStaffContext>(['pos-context']);
    if (!auth?.actor || !context || auth.actor.storeId !== context.storeId) {
      throw new Error('Không có ngữ cảnh nhân viên POS đã xác thực.');
    }
    const deviceId = auth.device?.id ?? (await this.localDeviceId());
    const now = Date.now();
    const id = crypto.randomUUID();
    const baseOrderVersion = input.baseQuote?.order.version ?? null;
    const snapshots: Array<Omit<PosLocalSnapshot, 'key'>> = [];
    if (input.optimisticQuote !== undefined) {
      snapshots.push({
        storeId: context.storeId,
        kind: 'ORDER_QUOTE',
        entityId: input.orderId,
        value: input.optimisticQuote,
        serverVersion: baseOrderVersion,
        updatedAt: now,
      });
    }
    if (input.optimisticOverview) {
      snapshots.push({
        storeId: context.storeId,
        kind: 'OVERVIEW',
        entityId: 'singleton',
        value: input.optimisticOverview,
        serverVersion: null,
        updatedAt: now,
      });
    }
    const command = await this.repository.enqueueCommand(
      {
        id,
        requestId: crypto.randomUUID(),
        storeId: context.storeId,
        deviceId,
        actorUserId: auth.actor.id,
        type: input.type,
        orderId: input.orderId,
        localOrderId: input.localOrderId ?? null,
        method: input.method ?? 'POST',
        path: input.path,
        body: input.body,
        baseOrderVersion,
        baseQuote: input.baseQuote ?? null,
        issuedAt: now,
        createdAt: now,
        status: 'PENDING',
        retryCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        acknowledgedAt: null,
        authoritativeOrderId: null,
        response: null,
        terminal: input.terminal ?? false,
      },
      snapshots,
    );
    if (input.optimisticQuote !== undefined) {
      this.queryClient.setQueryData(['pos-order-quote', input.orderId], input.optimisticQuote);
    }
    if (input.optimisticOverview) {
      this.queryClient.setQueryData(['pos-overview'], input.optimisticOverview);
      this.queryClient.setQueryData(['pos-tables'], input.optimisticOverview.tables);
      this.queryClient.setQueryData(['pos-orders-list'], input.optimisticOverview.orders);
    }
    this.setStatus({
      ...this.status,
      pendingCount: this.status.pendingCount + 1,
      pendingOrderIds: [...new Set([...this.status.pendingOrderIds, input.orderId])],
    });
    void this.syncNow();
    return command;
  }

  async syncNow() {
    if (!this.engine || document.visibilityState === 'hidden') return;
    const locks = navigator.locks;
    if (locks) {
      await locks.request(
        `propos-pos-sync:${this.storeId}`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await this.engine?.syncNow();
        },
      );
      return;
    }
    await this.engine.syncNow();
  }

  async pendingForOrder(orderId: string) {
    if (!this.storeId) return [];
    const commands = await this.repository.listCommands(this.storeId, [
      'PENDING',
      'SYNCING',
      'FAILED_RETRYABLE',
      'AUTH_REQUIRED',
      'CONFLICT',
    ]);
    return commands.filter((command) => command.orderId === orderId);
  }

  async listOpenConflicts(): Promise<PosConflictRecord[]> {
    if (!this.storeId) return [];
    return this.repository.listOpenConflicts(this.storeId);
  }

  async resolveConflict(conflictId: string): Promise<void> {
    await this.repository.resolveConflict(conflictId);
    if (this.storeId) {
      const openConflicts = await this.repository.listOpenConflicts(this.storeId);
      this.setStatus({ ...this.status, conflictCount: openConflicts.length });
    }
  }

  private async localDeviceId() {
    const existing = await this.repository.getMeta<string>('installationDeviceId');
    if (existing) return existing;
    const created = `device_${crypto.randomUUID()}`;
    await this.repository.putMeta('installationDeviceId', created);
    return created;
  }

  private async applyAcknowledgement(command: PosQueuedCommand, response: unknown) {
    if (!this.queryClient) return;
    const quote = extractQuote(response);
    const authoritativeOrderId = extractOrderId(response) ?? command.orderId;
    if (quote) {
      this.queryClient.setQueryData(['pos-order-quote', authoritativeOrderId], quote);
      if (command.localOrderId && command.localOrderId !== authoritativeOrderId) {
        this.queryClient.removeQueries({ queryKey: ['pos-order-quote', command.localOrderId] });
      }
      await this.repository.putSnapshot({
        storeId: command.storeId,
        kind: 'ORDER_QUOTE',
        entityId: authoritativeOrderId,
        value: quote,
        serverVersion:
          typeof quote === 'object' && quote
            ? ((quote as { order?: { version?: number } }).order?.version ?? null)
            : null,
        updatedAt: Date.now(),
      });
    }
    const snapshotTables =
      response && typeof response === 'object'
        ? (response as { tableSummaries?: unknown }).tableSummaries
        : null;
    if (Array.isArray(snapshotTables)) {
      const changed = new Map(
        snapshotTables
          .filter((table): table is { id: string } =>
            Boolean(table && typeof table.id === 'string'),
          )
          .map((table) => [table.id, table]),
      );
      this.queryClient.setQueryData<PosOverviewSnapshot>(['pos-overview'], (current) =>
        current
          ? {
              ...current,
              tables: current.tables.map(
                (table) => (changed.get(table.id) as typeof table | undefined) ?? table,
              ),
            }
          : current,
      );
    }
    if (command.type === 'CANCEL_ORDER' || command.type === 'CASH_CHECKOUT') {
      this.queryClient.setQueryData<PosOverviewSnapshot>(['pos-overview'], (current) =>
        current
          ? { ...current, orders: current.orders.filter((order) => order.id !== command.orderId) }
          : current,
      );
    }
  }

  private applyConflict(_conflict: PosConflictRecord) {
    this.setStatus({
      ...this.status,
      conflictCount: this.status.conflictCount + 1,
      pendingCount: Math.max(0, this.status.pendingCount - 1),
    });
  }

  private installSignals() {
    if (this.cleanupSignals) return;
    const sync = () => void this.syncNow();
    const onOnline = () => {
      this.setStatus({ ...this.status, reachable: null });
      sync();
    };
    const onOffline = () => this.setStatus({ ...this.status, reachable: false });
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pageshow', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisible);
    this.interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && this.status.pendingCount > 0) sync();
    }, 30_000);
    this.cleanupSignals = () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisible);
      if (this.interval !== null) window.clearInterval(this.interval);
    };
  }
}

export const posOfflineRuntime = new PosOfflineRuntime();
