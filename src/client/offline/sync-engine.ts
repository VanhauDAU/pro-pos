import { ApiError, jsonRequest } from '@client/lib/api';

import { resolvePosVersionConflict } from './conflict-resolver';
import { PosLocalRepository } from './repository';
import type {
  PosCommandBaseQuote,
  PosConflictRecord,
  PosOfflineStatus,
  PosQueuedCommand,
} from './types';

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 5 * 60_000;
const SYNCABLE_STATUSES: PosQueuedCommand['status'][] = [
  'PENDING',
  'FAILED_RETRYABLE',
  'AUTH_REQUIRED',
];

export interface PosCommandSender {
  send(command: PosQueuedCommand): Promise<unknown>;
  fetchQuote(orderId: string): Promise<PosCommandBaseQuote>;
}

export interface PosSyncCallbacks {
  onStatus(status: PosOfflineStatus): void;
  onAcknowledged(command: PosQueuedCommand, response: unknown): Promise<void> | void;
  onConflict(command: PosQueuedCommand, conflict: PosConflictRecord): Promise<void> | void;
}

function nextRetryAt(command: PosQueuedCommand, now = Date.now()) {
  const exponent = Math.min(command.retryCount, 8);
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
  const jitter = crypto.getRandomValues(new Uint32Array(1))[0]! / 0xffffffff;
  return now + Math.round(base * (0.8 + jitter * 0.4));
}

function isRetryable(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 || error.status === 429;
}

export class HttpPosCommandSender implements PosCommandSender {
  constructor(private readonly csrfToken: () => string | null) {}

  send(command: PosQueuedCommand) {
    const csrfToken = this.csrfToken();
    if (!csrfToken) {
      throw new ApiError(
        {
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Cần xác thực lại trước khi đồng bộ.',
            requestId: command.requestId,
          },
        },
        401,
      );
    }
    return jsonRequest<unknown>(command.path, command.body, {
      method: command.method,
      actionId: command.id,
      headers: {
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': command.id,
        'X-Request-ID': command.requestId,
        'X-POS-Device-ID': command.deviceId,
        'X-POS-Issued-At': String(command.issuedAt),
      },
    });
  }

  async fetchQuote(orderId: string) {
    const response = await fetch(`/api/v1/pos/orders/${orderId}/quote?projection=editor`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const payload = (await response.json()) as
      | { data: PosCommandBaseQuote }
      | { error: { code: string; message: string; requestId: string; details?: unknown } };
    if (!response.ok || 'error' in payload) {
      const envelope =
        'error' in payload
          ? payload
          : {
              error: {
                code: 'QUOTE_REFRESH_FAILED',
                message: 'Không thể tải trạng thái đơn mới nhất.',
                requestId: crypto.randomUUID(),
              },
            };
      throw new ApiError(envelope, response.status);
    }
    return payload.data;
  }
}

export class PosSyncEngine {
  private running: Promise<void> | null = null;
  private stopped = false;
  private reachable: boolean | null = null;
  private lastSyncedAt: number | null = null;

  constructor(
    private readonly repository: PosLocalRepository,
    private readonly sender: PosCommandSender,
    private readonly storeId: string,
    private readonly callbacks: PosSyncCallbacks,
  ) {}

  start() {
    this.stopped = false;
    return this.syncNow();
  }

  stop() {
    this.stopped = true;
  }

  syncNow(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async publishStatus(partial: Partial<PosOfflineStatus>) {
    const [pending, conflicts] = await Promise.all([
      this.repository.listCommands(this.storeId, [
        'PENDING',
        'SYNCING',
        'FAILED_RETRYABLE',
        'AUTH_REQUIRED',
      ]),
      this.repository.listOpenConflicts(this.storeId),
    ]);
    const pendingOrderIds = [...new Set(pending.map((cmd) => cmd.orderId))];
    this.callbacks.onStatus({
      reachable: this.reachable,
      syncing: false,
      pendingCount: pending.length,
      conflictCount: conflicts.length,
      authRequired: pending.some((command) => command.status === 'AUTH_REQUIRED'),
      lastSyncedAt: this.lastSyncedAt,
      pendingOrderIds,
      ...partial,
    });
  }

  private async run() {
    await this.repository.recoverInterruptedCommands(this.storeId);
    await this.publishStatus({ syncing: true });
    const commands = await this.repository.listCommands(this.storeId, SYNCABLE_STATUSES);
    const now = Date.now();
    const blockedOrders = new Set<string>();
    for (const command of commands) {
      if (this.stopped) break;
      if (blockedOrders.has(command.orderId) || command.nextAttemptAt > now) continue;
      const completed = await this.syncCommand(command);
      if (!completed) blockedOrders.add(command.orderId);
    }
    await this.repository.cleanup(this.storeId);
    this.lastSyncedAt = Date.now();
    await this.publishStatus({ syncing: false, lastSyncedAt: this.lastSyncedAt });
  }

  private async syncCommand(initial: PosQueuedCommand): Promise<boolean> {
    let command =
      (await this.repository.updateCommand(initial.id, (current) => ({
        ...current,
        status: 'SYNCING',
        lastAttemptAt: Date.now(),
        lastErrorCode: null,
        lastErrorMessage: null,
      }))) ?? initial;
    try {
      const response = await this.sender.send(command);
      this.reachable = true;
      command =
        (await this.repository.updateCommand(command.id, (current) => ({
          ...current,
          status: 'ACKNOWLEDGED',
          response,
          acknowledgedAt: Date.now(),
          authoritativeOrderId: authoritativeOrderId(response) ?? current.authoritativeOrderId,
        }))) ?? command;
      await this.callbacks.onAcknowledged(command, response);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.repository.updateCommand(command.id, (current) => ({
          ...current,
          status: 'AUTH_REQUIRED',
          retryCount: current.retryCount + 1,
          lastErrorCode: error.code,
          lastErrorMessage: error.message,
          nextAttemptAt: Date.now(),
        }));
        return false;
      }
      if (
        error instanceof ApiError &&
        (error.code === 'ORDER_VERSION_CONFLICT' || error.code === 'PAYMENT_SNAPSHOT_INVALID') &&
        !command.localOrderId
      ) {
        return this.reconcileConflict(command, error);
      }
      if (isRetryable(error)) {
        this.reachable = false;
        await this.repository.updateCommand(command.id, (current) => ({
          ...current,
          status: 'FAILED_RETRYABLE',
          retryCount: current.retryCount + 1,
          lastErrorCode: error instanceof ApiError ? error.code : 'NETWORK_ERROR',
          lastErrorMessage: error instanceof Error ? error.message : 'Network request failed',
          nextAttemptAt: nextRetryAt(current),
        }));
        await this.publishStatus({ reachable: false, syncing: true });
        return false;
      }
      return this.permanentFailure(command, error);
    }
  }

  private async reconcileConflict(command: PosQueuedCommand, cause: ApiError): Promise<boolean> {
    let latest: PosCommandBaseQuote;
    try {
      latest = await this.sender.fetchQuote(command.orderId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return this.recordConflict(command, 'TERMINAL_CONFLICT', 'Đơn không còn tồn tại.', null);
      }
      await this.repository.updateCommand(command.id, (current) => ({
        ...current,
        status: 'FAILED_RETRYABLE',
        retryCount: current.retryCount + 1,
        lastErrorCode: cause.code,
        lastErrorMessage: cause.message,
        nextAttemptAt: nextRetryAt(current),
      }));
      return false;
    }
    const resolution = resolvePosVersionConflict(command, latest);
    if (resolution.action === 'ACKNOWLEDGE') {
      const acknowledged = await this.repository.updateCommand(command.id, (current) => ({
        ...current,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: Date.now(),
        response: latest,
      }));
      if (acknowledged) await this.callbacks.onAcknowledged(acknowledged, latest);
      return true;
    }
    if (resolution.action === 'REBASE') {
      const rebased = await this.repository.updateCommand(command.id, (current) => ({
        ...current,
        body: resolution.body,
        baseOrderVersion: latest.order.version,
        baseQuote: latest,
        status: 'PENDING',
        nextAttemptAt: Date.now(),
      }));
      return rebased ? this.syncCommand(rebased) : false;
    }
    return this.recordConflict(command, resolution.conflictType, resolution.reason, latest);
  }

  private async recordConflict(
    command: PosQueuedCommand,
    type: PosConflictRecord['type'],
    reason: string,
    serverState: unknown,
  ) {
    const conflict: PosConflictRecord = {
      id: crypto.randomUUID(),
      commandId: command.id,
      storeId: command.storeId,
      orderId: command.orderId,
      type,
      reason,
      localIntent: command.body,
      serverState,
      createdAt: Date.now(),
      resolvedAt: null,
    };
    await this.repository.updateCommand(command.id, (current) => ({
      ...current,
      status: 'CONFLICT',
      lastErrorCode: type,
      lastErrorMessage: reason,
    }));
    await this.repository.addConflict(conflict);
    await this.callbacks.onConflict(command, conflict);
    return false;
  }

  private async permanentFailure(command: PosQueuedCommand, error: unknown) {
    await this.repository.updateCommand(command.id, (current) => ({
      ...current,
      status: 'FAILED_PERMANENT',
      retryCount: current.retryCount + 1,
      lastErrorCode: error instanceof ApiError ? error.code : 'PERMANENT_ERROR',
      lastErrorMessage: error instanceof Error ? error.message : 'Lệnh không hợp lệ.',
    }));
    return false;
  }
}

function authoritativeOrderId(response: unknown) {
  if (!response || typeof response !== 'object') return null;
  const record = response as { orderId?: unknown; order?: { id?: unknown } };
  if (typeof record.orderId === 'string') return record.orderId;
  return typeof record.order?.id === 'string' ? record.order.id : null;
}
