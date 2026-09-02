import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PosRealtimeClient } from '@client/realtime/client';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  playPosSound: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: notificationMocks.success,
    error: notificationMocks.error,
    warning: notificationMocks.warning,
  },
}));

vi.mock('@client/lib/sound', () => ({
  playPosSound: notificationMocks.playPosSound,
}));

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

type SocketEventMap = {
  close: CloseEvent;
  error: Event;
  message: MessageEvent;
  open: Event;
};

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];
  private readonly listeners = new Map<keyof SocketEventMap, Array<(event: never) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  addEventListener<Type extends keyof SocketEventMap>(
    type: Type,
    listener: (event: SocketEventMap[Type]) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as (event: never) => void);
    this.listeners.set(type, listeners);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = MockWebSocket.CLOSING;
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatch('open', new Event('open'));
  }

  serverMessage(payload: unknown) {
    this.dispatch('message', { data: JSON.stringify(payload) } as MessageEvent);
  }

  serverClose(code = 1006, reason = '', wasClean = false) {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close', { code, reason, wasClean } as CloseEvent);
  }

  private dispatch<Type extends keyof SocketEventMap>(type: Type, event: SocketEventMap[Type]) {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

function createClient() {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  return new PosRealtimeClient('store-1', queryClient, vi.fn(), vi.fn());
}

describe('PosRealtimeClient connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    MockWebSocket.instances.length = 0;
    vi.stubGlobal('sessionStorage', createSessionStorage());
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('window', {
      location: { origin: 'https://pos.example.test', protocol: 'https:' },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    notificationMocks.success.mockClear();
    notificationMocks.error.mockClear();
    notificationMocks.warning.mockClear();
    notificationMocks.playPosSound.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not create a duplicate socket while one is connecting or open', () => {
    const client = createClient();

    client.start();
    client.start();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0]!.open();
    (
      client as unknown as {
        connect: (reconnecting: boolean) => void;
      }
    ).connect(true);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after an intentional stop', async () => {
    const client = createClient();
    client.start();
    const socket = MockWebSocket.instances[0]!;
    socket.open();

    client.stop();
    socket.serverClose(1000, 'Realtime client stopped', true);
    await vi.runAllTimersAsync();

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: 'Realtime client stopped' }]);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reconnects once after an unexpected close using backoff', async () => {
    const client = createClient();
    client.start();
    MockWebSocket.instances[0]!.serverClose();

    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('uses capped exponential backoff for repeated unstable connections', async () => {
    const client = createClient();
    client.start();

    for (const [index, delay] of [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000].entries()) {
      MockWebSocket.instances.at(-1)!.serverClose();
      // Reconnect attempts are intentionally sequential; each close determines the next delay.
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(MockWebSocket.instances).toHaveLength(index + 1);
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(1);
      expect(MockWebSocket.instances).toHaveLength(index + 2);
    }
  });

  it('resets backoff after the connection remains stable', async () => {
    const client = createClient();
    client.start();
    MockWebSocket.instances[0]!.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);

    const stableSocket = MockWebSocket.instances[1]!;
    stableSocket.open();
    stableSocket.serverMessage({
      type: 'ready',
      connectionId: 'connection-2',
      serverNowMs: Date.now(),
      reauthAtMs: Date.now() + 5 * 60_000,
      schemaVersion: 1,
      sync: {
        mode: 'REPLAY',
        fromSequence: 0,
        toSequence: 0,
        serverNowMs: Date.now(),
        events: [],
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);

    stableSocket.serverClose();
    await vi.advanceTimersByTimeAsync(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('reconnects with the latest processed cursor', async () => {
    sessionStorage.setItem('propos:realtime:store-1:cursor', '4');
    const client = createClient();
    client.start();
    expect(MockWebSocket.instances[0]!.url).toContain('after=4');

    client.receiveBroadcastEvents([
      {
        schemaVersion: 1,
        eventId: 'event-5',
        sequence: 5,
        type: 'pos.order.changed',
        storeId: 'store-1',
        aggregate: { type: 'ORDER', id: 'order-1', version: 2 },
        occurredAtMs: Date.now(),
        actor: null,
        deviceId: null,
        clientMutationId: null,
        topics: ['pos.orders'],
        data: { reason: 'ITEM_UPDATED' },
      },
    ]);
    await vi.advanceTimersByTimeAsync(75);

    MockWebSocket.instances[0]!.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.instances[1]!.url).toContain('after=5');
  });

  it('keeps at most one reconnect timer', async () => {
    const client = createClient();
    client.start();
    MockWebSocket.instances[0]!.serverClose();

    const lifecycle = client as unknown as {
      scheduleReconnect: () => void;
    };
    lifecycle.scheduleReconnect();
    lifecycle.scheduleReconnect();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('ignores a stale socket close after a newer socket was created', async () => {
    const client = createClient();
    client.start();
    const staleSocket = MockWebSocket.instances[0]!;
    staleSocket.readyState = MockWebSocket.CLOSING;

    (
      client as unknown as {
        connect: (reconnecting: boolean) => void;
      }
    ).connect(true);
    expect(MockWebSocket.instances).toHaveLength(2);

    staleSocket.serverClose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it.each([
    {
      reason: 'PRINT_JOB_COMPLETED' as const,
      status: 'COMPLETED' as const,
      notify: notificationMocks.success,
      message: 'In thành công hóa đơn',
      failureMessage: null,
    },
    {
      reason: 'PRINT_JOB_FAILED' as const,
      status: 'FAILED' as const,
      notify: notificationMocks.error,
      message: 'In hóa đơn thất bại: Máy in hết giấy',
      failureMessage: 'Máy in hết giấy',
    },
    {
      reason: 'PRINT_JOB_UNCERTAIN' as const,
      status: 'UNCERTAIN' as const,
      notify: notificationMocks.warning,
      message: 'Không thể xác nhận in hóa đơn: Mất kết nối',
      failureMessage: 'Mất kết nối',
    },
  ])('shows the POS print toast for $status without a full job snapshot', async (testCase) => {
    const client = createClient();
    client.receiveBroadcastEvents([
      {
        schemaVersion: 1,
        eventId: `event-${testCase.status}`,
        sequence: 1,
        type: 'pos.print_job.updated',
        storeId: 'store-1',
        aggregate: { type: 'PRINT_JOB', id: 'job-1', version: 1 },
        occurredAtMs: Date.now(),
        actor: null,
        deviceId: null,
        clientMutationId: null,
        topics: ['pos.print_jobs', 'pos.print_job:job-1'],
        data: {
          reason: testCase.reason,
          printJobId: 'job-1',
          printJobStatus: testCase.status,
          printerRole: 'receipt',
          documentType: 'invoice',
          failureCode: testCase.status === 'FAILED' ? 'OUT_OF_PAPER' : null,
          failureMessage: testCase.failureMessage,
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(testCase.notify).toHaveBeenCalledWith(expect.stringContaining(testCase.message));
    expect(notificationMocks.playPosSound).toHaveBeenCalledOnce();
  });
});
