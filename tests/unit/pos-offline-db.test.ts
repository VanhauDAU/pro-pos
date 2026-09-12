import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { PosLocalRepository } from '@client/offline/repository';
import type { PosConflictRecord, PosQueuedCommand } from '@client/offline/types';

describe('PosLocalRepository (IndexedDB)', () => {
  let repository: PosLocalRepository;

  beforeEach(() => {
    repository = new PosLocalRepository();
  });

  it('stores and retrieves meta entries', async () => {
    await repository.putMeta('lastStoreId', 'store-123');
    const retrieved = await repository.getMeta<string>('lastStoreId');
    expect(retrieved).toBe('store-123');

    const nonexistent = await repository.getMeta<string>('nonexistent');
    expect(nonexistent).toBeNull();
  });

  it('enqueues command with atomic snapshots and queries commands', async () => {
    const now = Date.now();
    const command: PosQueuedCommand = {
      id: 'cmd-1',
      sequence: 1,
      requestId: 'req-1',
      storeId: 'store-1',
      deviceId: 'dev-1',
      actorUserId: 'user-1',
      type: 'OPEN_ORDER',
      orderId: 'order-1',
      localOrderId: null,
      method: 'POST',
      path: '/api/v1/pos/orders/open',
      body: { orderType: 'DINE_IN' },
      baseOrderVersion: null,
      baseQuote: null,
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
      terminal: false,
    };

    const quoteSnapshot = {
      storeId: 'store-1',
      kind: 'ORDER_QUOTE' as const,
      entityId: 'order-1',
      value: { totalVnd: 50000 },
      serverVersion: null,
      updatedAt: now,
    };

    await repository.enqueueCommand(command, [quoteSnapshot]);

    const retrieved = await repository.getCommand('cmd-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('cmd-1');
    expect(retrieved?.status).toBe('PENDING');

    const pendingCommands = await repository.listCommands('store-1', ['PENDING']);
    expect(pendingCommands.length).toBe(1);
    expect(pendingCommands[0]?.orderId).toBe('order-1');

    const snapshot = await repository.getSnapshot('store-1', 'ORDER_QUOTE', 'order-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.value).toEqual({ totalVnd: 50000 });
  });

  it('manages local drafts in drafts store', async () => {
    const draftData = {
      baseVersion: 1,
      lines: [{ id: 'item-1', name: 'Trà đào' }],
      savedAt: Date.now(),
    };

    await repository.saveDraft('store-1', 'order-10', draftData);
    const retrieved = await repository.getDraft('store-1', 'order-10');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.value).toEqual(draftData);

    await repository.deleteDraft('store-1', 'order-10');
    const afterDelete = await repository.getDraft('store-1', 'order-10');
    expect(afterDelete).toBeNull();
  });

  it('records, lists, and resolves conflicts', async () => {
    const conflictRecord: PosConflictRecord = {
      id: 'conflict-1',
      commandId: 'cmd-1',
      storeId: 'store-1',
      orderId: 'order-1',
      type: 'BUSINESS_CONFLICT',
      reason: 'Món đã bị thay đổi trên thiết bị khác.',
      localIntent: { items: ['item-1'] },
      serverState: { items: ['item-2'] },
      resolvedAt: null,
      createdAt: Date.now(),
    };

    await repository.addConflict(conflictRecord);

    const openConflicts = await repository.listOpenConflicts('store-1');
    expect(openConflicts.length).toBe(1);
    expect(openConflicts[0]?.id).toBe('conflict-1');

    await repository.resolveConflict('conflict-1');
    const resolvedConflicts = await repository.listOpenConflicts('store-1');
    expect(resolvedConflicts.length).toBe(0);
  });

  it('prunes acknowledged commands older than 7 days retention while preserving pending', async () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const oneDayAgo = now - 1 * 24 * 60 * 60 * 1000;

    const oldAcked: PosQueuedCommand = {
      id: 'cmd-old',
      sequence: 1,
      requestId: 'req-old',
      storeId: 'store-1',
      deviceId: 'dev-1',
      actorUserId: 'user-1',
      type: 'SAVE_ORDER',
      orderId: 'order-1',
      localOrderId: null,
      method: 'POST',
      path: '/api/v1/pos/orders/order-1/save',
      body: {},
      baseOrderVersion: 1,
      baseQuote: null,
      issuedAt: eightDaysAgo,
      createdAt: eightDaysAgo,
      status: 'ACKNOWLEDGED',
      retryCount: 1,
      lastAttemptAt: eightDaysAgo,
      nextAttemptAt: eightDaysAgo,
      lastErrorCode: null,
      lastErrorMessage: null,
      acknowledgedAt: eightDaysAgo,
      authoritativeOrderId: null,
      response: {},
      terminal: false,
    };

    const recentPending: PosQueuedCommand = {
      ...oldAcked,
      id: 'cmd-pending',
      status: 'PENDING',
      acknowledgedAt: null,
      createdAt: oneDayAgo,
    };

    await repository.enqueueCommand(oldAcked);
    await repository.enqueueCommand(recentPending);

    await repository.cleanup('store-1', now);

    expect(await repository.getCommand('cmd-old')).toBeNull();
    expect(await repository.getCommand('cmd-pending')).not.toBeNull();
  });
});
