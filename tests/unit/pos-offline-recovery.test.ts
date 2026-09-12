import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PosLocalRepository } from '@client/offline/repository';
import { PosSyncEngine, type PosCommandSender } from '@client/offline/sync-engine';
import type { PosQueuedCommand } from '@client/offline/types';

describe('PosOffline Recovery & Idempotency', () => {
  let repository: PosLocalRepository;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('propos-offline-v1');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    repository = new PosLocalRepository();
  });

  function makeCommand(overrides: Partial<PosQueuedCommand>): PosQueuedCommand {
    const now = Date.now();
    return {
      sequence: overrides.sequence ?? 1,
      id: overrides.id ?? crypto.randomUUID(),
      requestId: crypto.randomUUID(),
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
      ...overrides,
    };
  }

  it('recovers commands stuck in SYNCING after crash/tab close to FAILED_RETRYABLE', async () => {
    const cmd = makeCommand({ id: 'cmd-stuck', storeId: 'store-rec-1', orderId: 'order-stuck', status: 'SYNCING' });
    await repository.enqueueCommand(cmd);

    await repository.recoverInterruptedCommands('store-rec-1');

    const recovered = await repository.getCommand('cmd-stuck');
    expect(recovered?.status).toBe('FAILED_RETRYABLE');
    expect(recovered?.lastErrorCode).toBe('SYNC_INTERRUPTED');
    expect(recovered?.lastErrorMessage).toContain('Ứng dụng đã đóng');
  });

  it('handles dropped network response with idempotent replay', async () => {
    let sendCalls = 0;
    const serverQuote = { order: { id: 'order-idempotent-1', version: 2 }, totalVnd: 50000 };

    const mockSender: PosCommandSender = {
      send: vi.fn(async (cmd) => {
        sendCalls += 1;
        if (sendCalls === 1) {
          // First attempt: Server processed command, but connection dropped before response arrived
          throw new TypeError('Failed to fetch');
        }
        // Second attempt: Replaying exact same command ID / idempotency key -> returns cached server result
        return { quote: serverQuote, clientMutationId: cmd.id };
      }),
      fetchQuote: vi.fn(),
    };

    const cmd = makeCommand({
      id: 'cmd-idempotent-1',
      storeId: 'store-rec-2',
      orderId: 'order-idempotent-1',
      nextAttemptAt: Date.now() - 1000,
    });
    await repository.enqueueCommand(cmd);

    const onAck = vi.fn();
    const engine = new PosSyncEngine(repository, mockSender, 'store-rec-2', {
      onStatus: vi.fn(),
      onAcknowledged: onAck,
      onConflict: vi.fn(),
    });

    // First run fails due to network drop
    await engine.syncNow();
    let state = await repository.getCommand('cmd-idempotent-1');
    expect(state?.status).toBe('FAILED_RETRYABLE');
    expect(onAck).not.toHaveBeenCalled();

    // Reset nextAttemptAt to allow immediate second run
    await repository.updateCommand('cmd-idempotent-1', (c) => ({ ...c, nextAttemptAt: Date.now() - 1000 }));

    // Second run succeeds with the same command ID
    await engine.syncNow();
    state = await repository.getCommand('cmd-idempotent-1');
    expect(state?.status).toBe('ACKNOWLEDGED');
    expect(onAck).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cmd-idempotent-1' }),
      expect.objectContaining({ quote: serverQuote }),
    );
  });

  it('hydrates cached snapshots for offline bootstrap and overview', async () => {
    const now = Date.now();
    await repository.putMeta('lastStoreId', 'store-rec-3');

    await repository.putSnapshot({
      storeId: 'store-rec-3',
      kind: 'BOOTSTRAP',
      entityId: 'singleton',
      value: { storeName: 'Quán Cafe Pro' },
      serverVersion: null,
      updatedAt: now,
    });

    await repository.putSnapshot({
      storeId: 'store-rec-3',
      kind: 'OVERVIEW',
      entityId: 'singleton',
      value: { tables: [{ id: 'table-1', name: 'Bàn 1' }], orders: [] },
      serverVersion: null,
      updatedAt: now,
    });

    await repository.putSnapshot({
      storeId: 'store-rec-3',
      kind: 'ORDER_QUOTE',
      entityId: 'order-10',
      value: { order: { id: 'order-10', tableName: 'Bàn 1' }, totalVnd: 75000 },
      serverVersion: 1,
      updatedAt: now,
    });

    const hydration = await repository.hydration();
    expect(hydration.bootstrap).not.toBeNull();
    expect((hydration.bootstrap as any)?.storeName).toBe('Quán Cafe Pro');
    expect(hydration.overview).not.toBeNull();
    expect(hydration.orderQuotes.length).toBe(1);
    expect((hydration.orderQuotes[0]?.value as any)?.totalVnd).toBe(75000);
  });
});
