import {
  POS_LOCAL_DB_NAME,
  POS_LOCAL_DB_VERSION,
  type PosConflictRecord,
  type PosDraftRecord,
  type PosLocalSnapshot,
  type PosQueuedCommand,
} from './types';

export type PosObjectStoreName = 'meta' | 'snapshots' | 'drafts' | 'commands' | 'conflicts';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      { once: true },
    );
  });
}

function createSchema(database: IDBDatabase) {
  const meta = database.createObjectStore('meta', { keyPath: 'key' });
  meta.createIndex('updatedAt', 'updatedAt');

  const snapshots = database.createObjectStore('snapshots', { keyPath: 'key' });
  snapshots.createIndex('storeKind', ['storeId', 'kind']);
  snapshots.createIndex('storeUpdatedAt', ['storeId', 'updatedAt']);

  const drafts = database.createObjectStore('drafts', { keyPath: 'key' });
  drafts.createIndex('storeOrder', ['storeId', 'orderId'], { unique: true });
  drafts.createIndex('storeUpdatedAt', ['storeId', 'updatedAt']);

  const commands = database.createObjectStore('commands', { keyPath: 'id' });
  commands.createIndex('storeStatus', ['storeId', 'status']);
  commands.createIndex('storeOrderSequence', ['storeId', 'orderId', 'sequence'], { unique: true });
  commands.createIndex('nextAttemptAt', 'nextAttemptAt');
  commands.createIndex('acknowledgedAt', 'acknowledgedAt');

  const conflicts = database.createObjectStore('conflicts', { keyPath: 'id' });
  conflicts.createIndex('storeResolvedAt', ['storeId', 'resolvedAt']);
  conflicts.createIndex('storeOrder', ['storeId', 'orderId']);
  conflicts.createIndex('commandId', 'commandId', { unique: true });
}

let databasePromise: Promise<IDBDatabase> | null = null;

export function openPosDatabase(indexedDb: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  const isDefaultFactory = indexedDb === globalThis.indexedDB;
  if (isDefaultFactory && databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(POS_LOCAL_DB_NAME, POS_LOCAL_DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      const versionEvent = event as IDBVersionChangeEvent;
      if (versionEvent.oldVersion === 0) createSchema(request.result);
    });
    request.addEventListener('success', () => {
      const database = request.result;
      database.addEventListener('versionchange', () => database.close());
      resolve(database);
    });
    request.addEventListener(
      'blocked',
      () => reject(new Error('IndexedDB upgrade is blocked by another POS window')),
      { once: true },
    );
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Unable to open POS IndexedDB')),
      { once: true },
    );
  });
  if (isDefaultFactory) databasePromise = opening;
  return opening;
}

export async function withPosTransaction<T>(
  stores: PosObjectStoreName[],
  mode: IDBTransactionMode,
  callback: (transaction: IDBTransaction) => Promise<T> | T,
  indexedDb?: IDBFactory,
): Promise<T> {
  const database = await openPosDatabase(indexedDb);
  const transaction = database.transaction(stores, mode, { durability: 'strict' });
  const completed = transactionDone(transaction);
  try {
    const result = await callback(transaction);
    await completed;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have committed or aborted.
    }
    await completed.catch(() => undefined);
    throw error;
  }
}

export async function getAllFromIndex<T>(
  store: IDBObjectStore,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return requestResult(store.index(indexName).getAll(query)) as Promise<T[]>;
}

export function getRecord<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return requestResult(store.get(key)) as Promise<T | undefined>;
}

export function putRecord(
  store: IDBObjectStore,
  value: PosLocalSnapshot | PosDraftRecord | PosQueuedCommand | PosConflictRecord | object,
): Promise<IDBValidKey> {
  return requestResult(store.put(value));
}

export function deleteRecord(store: IDBObjectStore, key: IDBValidKey): Promise<undefined> {
  return requestResult(store.delete(key));
}

export function resetPosDatabaseForTests() {
  databasePromise = null;
}
