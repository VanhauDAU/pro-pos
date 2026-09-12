import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PosLocalRepository } from '@client/offline/repository';
import { PosSyncEngine, type PosCommandSender } from '@client/offline/sync-engine';
import type { PosQueuedCommand } from '@client/offline/types';

describe('PosSyncEngine Queue Sequencing & Retry Policy', () => {
  let repository: PosLocalRepository;

  beforeEach(() => {
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

  it('executes queued commands for an order strictly sequentially in FIFO order', async () => {
    const executionOrder: string[] = [];
    const mockSender: PosCommandSender = {
      send: vi.fn(async (cmd) => {
        executionOrder.push(cmd.id);
        return { quote: { order: { id: cmd.orderId, version: 2 } } };
      }),
      fetchQuote: vi.fn(),
    };

    const cmd1 = makeCommand({ id: 'cmd-1', createdAt: 1000 });
    const cmd2 = makeCommand({ id: 'cmd-2', createdAt: 2000 });

    await repository.enqueueCommand(cmd1);
    await repository.enqueueCommand(cmd2);

    const onAck = vi.fn();
    const engine = new PosSyncEngine(repository, mockSender, 'store-1', {
      onStatus: vi.fn(),
      onAcknowledged: onAck,
      onConflict: vi.fn(),
    });

    await engine.syncNow();

    expect(executionOrder).toEqual(['cmd-1', 'cmd-2']);
    expect(onAck).toHaveBeenCalledTimes(2);

    const updated1 = await repository.getCommand('cmd-1');
    const updated2 = await repository.getCommand('cmd-2');
    expect(updated1?.status).toBe('ACKNOWLEDGED');
    expect(updated2?.status).toBe('ACKNOWLEDGED');
  });

  it('applies exponential backoff and marks FAILED_RETRYABLE on network error', async () => {
    const mockSender: PosCommandSender = {
      send: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
      fetchQuote: vi.fn(),
    };

    const beforeAttempt = Date.now();
    const cmd = makeCommand({ id: 'cmd-fail', retryCount: 0 });
    await repository.enqueueCommand(cmd);

    const engine = new PosSyncEngine(repository, mockSender, 'store-1', {
      onStatus: vi.fn(),
      onAcknowledged: vi.fn(),
      onConflict: vi.fn(),
    });

    await engine.syncNow();

    const updated = await repository.getCommand('cmd-fail');
    expect(updated?.status).toBe('FAILED_RETRYABLE');
    expect(updated?.retryCount).toBe(1);
    expect(updated?.lastErrorCode).toBe('NETWORK_ERROR');
    expect(updated?.nextAttemptAt).toBeGreaterThan(beforeAttempt + 300);
  });

  it('stops processing subsequent commands for the same order when earlier command fails', async () => {
    const executed: string[] = [];
    const mockSender: PosCommandSender = {
      send: vi.fn(async (cmd) => {
        executed.push(cmd.id);
        if (cmd.id === 'cmd-1') {
          throw new TypeError('Network timeout');
        }
        return { quote: { order: { id: cmd.orderId } } };
      }),
      fetchQuote: vi.fn(),
    };

    const cmd1 = makeCommand({ id: 'cmd-1', orderId: 'order-A', createdAt: 1000 });
    const cmd2 = makeCommand({ id: 'cmd-2', orderId: 'order-A', createdAt: 2000 });
    await repository.enqueueCommand(cmd1);
    await repository.enqueueCommand(cmd2);

    const engine = new PosSyncEngine(repository, mockSender, 'store-1', {
      onStatus: vi.fn(),
      onAcknowledged: vi.fn(),
      onConflict: vi.fn(),
    });

    await engine.syncNow();

    expect(executed).toEqual(['cmd-1']);
    const state1 = await repository.getCommand('cmd-1');
    const state2 = await repository.getCommand('cmd-2');
    expect(state1?.status).toBe('FAILED_RETRYABLE');
    expect(state2?.status).toBe('PENDING');
  });
});
