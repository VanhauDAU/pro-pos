import type { AppBootstrapResponse } from '@contracts/app-bootstrap';
import type { PosOverviewSnapshot } from '@contracts/pos';

import {
  deleteRecord,
  getAllFromIndex,
  getRecord,
  putRecord,
  withPosTransaction,
} from './db';
import type {
  PosConflictRecord,
  PosDraftRecord,
  PosHydrationResult,
  PosLocalSnapshot,
  PosQueuedCommand,
  PosSnapshotKind,
} from './types';

const ACK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function snapshotKey(storeId: string, kind: PosSnapshotKind, entityId = 'singleton') {
  return `${storeId}:${kind}:${entityId}`;
}

function draftKey(storeId: string, orderId: string) {
  return `${storeId}:${orderId}`;
}

export class PosLocalRepository {
  constructor(private readonly indexedDb?: IDBFactory) {}

  async putSnapshot<T>(input: Omit<PosLocalSnapshot<T>, 'key'>): Promise<void> {
    await withPosTransaction(
      ['snapshots'],
      'readwrite',
      async (transaction) => {
        await putRecord(transaction.objectStore('snapshots'), {
          ...input,
          key: snapshotKey(input.storeId, input.kind, input.entityId),
        });
      },
      this.indexedDb,
    );
  }

  async getSnapshot<T>(
    storeId: string,
    kind: PosSnapshotKind,
    entityId = 'singleton',
  ): Promise<PosLocalSnapshot<T> | null> {
    return withPosTransaction(
      ['snapshots'],
      'readonly',
      async (transaction) =>
        (await getRecord<PosLocalSnapshot<T>>(
          transaction.objectStore('snapshots'),
          snapshotKey(storeId, kind, entityId),
        )) ?? null,
      this.indexedDb,
    );
  }

  async putMeta<T>(key: string, value: T): Promise<void> {
    await withPosTransaction(
      ['meta'],
      'readwrite',
      async (transaction) => {
        await putRecord(transaction.objectStore('meta'), { key, value, updatedAt: Date.now() });
      },
      this.indexedDb,
    );
  }

  async getMeta<T>(key: string): Promise<T | null> {
    return withPosTransaction(
      ['meta'],
      'readonly',
      async (transaction) => {
        const record = await getRecord<{ key: string; value: T }>(
          transaction.objectStore('meta'),
          key,
        );
        return record?.value ?? null;
      },
      this.indexedDb,
    );
  }

  async saveDraft<T>(storeId: string, orderId: string, value: T): Promise<PosDraftRecord<T>> {
    return withPosTransaction(
      ['drafts'],
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore('drafts');
        const key = draftKey(storeId, orderId);
        const current = await getRecord<PosDraftRecord<T>>(store, key);
        const record: PosDraftRecord<T> = {
          key,
          storeId,
          orderId,
          value,
          localRevision: (current?.localRevision ?? 0) + 1,
          updatedAt: Date.now(),
        };
        await putRecord(store, record);
        return record;
      },
      this.indexedDb,
    );
  }

  async getDraft<T>(storeId: string, orderId: string): Promise<PosDraftRecord<T> | null> {
    return withPosTransaction(
      ['drafts'],
      'readonly',
      async (transaction) =>
        (await getRecord<PosDraftRecord<T>>(
          transaction.objectStore('drafts'),
          draftKey(storeId, orderId),
        )) ?? null,
      this.indexedDb,
    );
  }

  async deleteDraft(storeId: string, orderId: string): Promise<void> {
    await withPosTransaction(
      ['drafts'],
      'readwrite',
      async (transaction) => {
        await deleteRecord(transaction.objectStore('drafts'), draftKey(storeId, orderId));
      },
      this.indexedDb,
    );
  }

  async enqueueCommand(
    command: Omit<PosQueuedCommand, 'sequence'>,
    snapshots: Array<Omit<PosLocalSnapshot, 'key'>> = [],
  ): Promise<PosQueuedCommand> {
    return withPosTransaction(
      snapshots.length > 0 ? ['commands', 'snapshots'] : ['commands'],
      'readwrite',
      async (transaction) => {
        const commandStore = transaction.objectStore('commands');
        const records = await getAllFromIndex<PosQueuedCommand>(
          commandStore,
          'storeOrderSequence',
          IDBKeyRange.bound(
            [command.storeId, command.orderId, 0],
            [command.storeId, command.orderId, Number.MAX_SAFE_INTEGER],
          ),
        );
        const queued: PosQueuedCommand = {
          ...command,
          sequence: (records.at(-1)?.sequence ?? 0) + 1,
        };
        await putRecord(commandStore, queued);
        if (snapshots.length > 0) {
          const snapshotStore = transaction.objectStore('snapshots');
          for (const snapshot of snapshots) {
            await putRecord(snapshotStore, {
              ...snapshot,
              key: snapshotKey(snapshot.storeId, snapshot.kind, snapshot.entityId),
            });
          }
        }
        return queued;
      },
      this.indexedDb,
    );
  }

  async getCommand(commandId: string): Promise<PosQueuedCommand | null> {
    return withPosTransaction(
      ['commands'],
      'readonly',
      async (transaction) =>
        (await getRecord<PosQueuedCommand>(transaction.objectStore('commands'), commandId)) ?? null,
      this.indexedDb,
    );
  }

  async updateCommand(
    commandId: string,
    update: (command: PosQueuedCommand) => PosQueuedCommand,
  ): Promise<PosQueuedCommand | null> {
    return withPosTransaction(
      ['commands'],
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore('commands');
        const current = await getRecord<PosQueuedCommand>(store, commandId);
        if (!current) return null;
        const next = update(current);
        await putRecord(store, next);
        return next;
      },
      this.indexedDb,
    );
  }

  async listCommands(storeId: string, statuses?: PosQueuedCommand['status'][]): Promise<PosQueuedCommand[]> {
    return withPosTransaction(
      ['commands'],
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore('commands');
        const records = statuses
          ? (
              await Promise.all(
                statuses.map((status) =>
                  getAllFromIndex<PosQueuedCommand>(
                    store,
                    'storeStatus',
                    IDBKeyRange.only([storeId, status]),
                  ),
                ),
              )
            ).flat()
          : await requestAll<PosQueuedCommand>(store);
        return records
          .filter((command) => command.storeId === storeId)
          .toSorted((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
      },
      this.indexedDb,
    );
  }

  async addConflict(conflict: PosConflictRecord): Promise<void> {
    await withPosTransaction(
      ['conflicts'],
      'readwrite',
      async (transaction) => {
        await putRecord(transaction.objectStore('conflicts'), conflict);
      },
      this.indexedDb,
    );
  }

  async listOpenConflicts(storeId: string): Promise<PosConflictRecord[]> {
    return withPosTransaction(
      ['conflicts'],
      'readonly',
      async (transaction) => {
        const records = await requestAll<PosConflictRecord>(transaction.objectStore('conflicts'));
        return records.filter((record) => record.storeId === storeId && record.resolvedAt === null);
      },
      this.indexedDb,
    );
  }

  async resolveConflict(conflictId: string): Promise<void> {
    await withPosTransaction(
      ['conflicts'],
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore('conflicts');
        const current = await getRecord<PosConflictRecord>(store, conflictId);
        if (!current) return;
        await putRecord(store, { ...current, resolvedAt: Date.now() });
      },
      this.indexedDb,
    );
  }

  async recoverInterruptedCommands(storeId: string): Promise<void> {
    const syncing = await this.listCommands(storeId, ['SYNCING']);
    for (const command of syncing) {
      await this.updateCommand(command.id, (current) => ({
        ...current,
        status: 'FAILED_RETRYABLE',
        nextAttemptAt: Date.now(),
        lastErrorCode: 'SYNC_INTERRUPTED',
        lastErrorMessage: 'Ứng dụng đã đóng trước khi nhận phản hồi.',
      }));
    }
  }

  async cleanup(storeId: string, now = Date.now()): Promise<void> {
    const acknowledged = await this.listCommands(storeId, ['ACKNOWLEDGED']);
    for (const command of acknowledged) {
      if (command.acknowledgedAt !== null && command.acknowledgedAt < now - ACK_RETENTION_MS) {
        await withPosTransaction(
          ['commands'],
          'readwrite',
          async (transaction) => {
            await deleteRecord(transaction.objectStore('commands'), command.id);
          },
          this.indexedDb,
        );
      }
    }
  }

  async hydration(): Promise<PosHydrationResult> {
    return withPosTransaction(
      ['snapshots', 'meta'],
      'readonly',
      async (transaction) => {
        const lastStoreRecord = await getRecord<{ key: string; value: string }>(
          transaction.objectStore('meta'),
          'lastStoreId',
        );
        const storeId = lastStoreRecord?.value;
        if (!storeId) return { bootstrap: null, overview: null, catalog: null, orderQuotes: [] };
        const snapshots = await getAllFromIndex<PosLocalSnapshot>(
          transaction.objectStore('snapshots'),
          'storeUpdatedAt',
          IDBKeyRange.bound([storeId, 0], [storeId, Number.MAX_SAFE_INTEGER]),
        );
        const bootstrap = snapshots.find((snapshot) => snapshot.kind === 'BOOTSTRAP');
        const overview = snapshots.find((snapshot) => snapshot.kind === 'OVERVIEW');
        const catalog = snapshots.find((snapshot) => snapshot.kind === 'CATALOG');
        return {
          bootstrap: (bootstrap?.value as AppBootstrapResponse | undefined) ?? null,
          overview: (overview?.value as PosOverviewSnapshot | undefined) ?? null,
          catalog: (catalog?.value as unknown[] | undefined) ?? null,
          orderQuotes: snapshots
            .filter((snapshot) => snapshot.kind === 'ORDER_QUOTE')
            .map((snapshot) => ({ orderId: snapshot.entityId, value: snapshot.value })),
        };
      },
      this.indexedDb,
    );
  }
}

function requestAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.addEventListener('success', () => resolve(request.result as T[]), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}
