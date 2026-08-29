import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../apps/print-agent/src/core/agent-runtime';
import type { PrintAgentConfig } from '../../apps/print-agent/src/config';
import { AgentRealtimeClient } from '../../apps/print-agent/src/realtime-client';
import { PrinterError } from '../../src/printing/printer-errors';
import { AgentApiClient, AgentApiError } from '../../apps/print-agent/src/api-client';

const pairedConfig: PrintAgentConfig = {
  serverUrl: 'https://pos.example',
  storeId: 'STORE-1',
  agentId: 'AGENT-1',
  agentSecret: 'secret',
  printerIp: '192.168.1.73',
  printerPort: 9100,
};

function makeConfigStore(config: PrintAgentConfig) {
  return {
    loadConfig: vi.fn(() => config),
    saveConfig: vi.fn(),
    isPaired: (candidate: PrintAgentConfig) =>
      Boolean(candidate.agentId && candidate.agentSecret && candidate.storeId),
  };
}

describe('AgentRuntime', () => {
  it('owns the paired realtime lifecycle and cleans it up on stop', async () => {
    const realtime = { connect: vi.fn(), destroy: vi.fn() };
    const runtime = new AgentRuntime(pairedConfig, {
      configManager: makeConfigStore(pairedConfig),
      createApiClient: () => ({}) as never,
      createRealtimeClient: () => realtime,
    });
    const states: string[] = [];
    runtime.on('stateChanged', (state) => states.push(state.status));

    await runtime.start();
    expect(realtime.connect).toHaveBeenCalledOnce();
    expect(runtime.getState().status).toBe('CONNECTING');

    await runtime.stop();
    expect(realtime.destroy).toHaveBeenCalledOnce();
    expect(runtime.getState().status).toBe('STOPPED');
    expect(states).toEqual(['CONNECTING', 'STOPPED']);
  });

  it('publishes pairing state, then starts realtime through the same runtime', async () => {
    const unpaired: PrintAgentConfig = { serverUrl: 'https://pos.example' };
    const realtime = { connect: vi.fn(), destroy: vi.fn() };
    const pairingChanged = vi.fn();
    const runtime = new AgentRuntime(unpaired, {
      configManager: makeConfigStore(unpaired),
      createApiClient: () => ({}) as never,
      createRealtimeClient: () => realtime,
      createPairingHandler: () => ({
        startPairingFlow: async ({ onCodeReady } = {}) => {
          onCodeReady?.('123456', 1_800_000_000_000);
          return pairedConfig;
        },
      }),
    });
    runtime.on('pairingChanged', pairingChanged);

    await runtime.start();
    expect(runtime.getState().status).toBe('UNPAIRED');
    await runtime.startPairing();

    expect(pairingChanged).toHaveBeenCalledWith({ code: '123456', expiresAt: 1_800_000_000_000 });
    expect(pairingChanged).toHaveBeenLastCalledWith({ code: null, expiresAt: null });
    expect(runtime.getConfig()).toMatchObject({ agentId: 'AGENT-1', storeId: 'STORE-1' });
    expect(realtime.connect).toHaveBeenCalledOnce();
  });

  it('keeps a replacement pairing flow active while the previous request aborts', async () => {
    const unpaired: PrintAgentConfig = { serverUrl: 'https://pos.example' };
    let flow = 0;
    const runtime = new AgentRuntime(unpaired, {
      configManager: makeConfigStore(unpaired),
      createPairingHandler: () => ({
        startPairingFlow: ({ signal, onCodeReady } = {}) => {
          flow += 1;
          if (flow === 2) onCodeReady?.('654321', Date.now() + 60_000);
          return new Promise<PrintAgentConfig>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        },
      }),
    });
    await runtime.start();

    const first = runtime.startPairing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replacement = runtime.startPairing();
    await first;
    expect(runtime.getState()).toMatchObject({
      status: 'PAIRING',
      pairing: { code: '654321' },
    });

    runtime.cancelPairing();
    await replacement;
  });

  it('reports printer readiness through runtime state without exposing transport to a UI', async () => {
    const send = vi.fn(async () => undefined);
    const runtime = new AgentRuntime(pairedConfig, {
      configManager: makeConfigStore(pairedConfig),
      createTransport: () => ({ send }),
    });

    const result = await runtime.testPrinter();
    expect(result).toEqual({ ok: true, host: '192.168.1.73', port: 9100 });
    expect(send).toHaveBeenCalledOnce();
    expect(runtime.getState().printer).toBe('READY');
    expect(runtime.getState().printerDiagnostics).toBeNull();
  });

  it('maps safe TCP diagnostics without exposing config credentials', async () => {
    const networkError = Object.assign(new Error('connect EHOSTUNREACH'), {
      code: 'EHOSTUNREACH',
      localAddress: '192.168.1.144',
      localPort: 54_321,
    });
    const runtime = new AgentRuntime(pairedConfig, {
      configManager: makeConfigStore(pairedConfig),
      createTransport: () => ({
        send: async () => {
          throw new PrinterError('NETWORK_PRINTER_UNREACHABLE', networkError.message, {
            cause: networkError,
            failureStage: 'BEFORE_WRITE',
            localAddress: networkError.localAddress,
            localPort: networkError.localPort,
          });
        },
      }),
    });

    const result = await runtime.testPrinter();

    expect(result).toMatchObject({
      ok: false,
      diagnostics: {
        errorCode: 'EHOSTUNREACH',
        printerCode: 'NETWORK_PRINTER_UNREACHABLE',
        host: '192.168.1.73',
        port: 9100,
        failureStage: 'BEFORE_WRITE',
        localAddress: '192.168.1.144',
        localPort: 54_321,
      },
    });
    expect(JSON.stringify(result)).not.toContain(pairedConfig.agentSecret);
    expect(runtime.getState().printer).toBe('UNREACHABLE');
  });

  it('reports invalid printer configuration without opening a TCP connection', async () => {
    const send = vi.fn(async () => undefined);
    const config = { ...pairedConfig, printerIp: '  ' };
    const runtime = new AgentRuntime(config, {
      configManager: makeConfigStore(config),
      createTransport: () => ({ send }),
    });

    const result = await runtime.testPrinter();
    expect(result).toMatchObject({ ok: false, error: 'Địa chỉ IP máy in không hợp lệ.' });
    expect(send).not.toHaveBeenCalled();
    expect(runtime.getState().printer).toBe('INVALID_CONFIG');
  });

  it('keeps reconnect scoped to the cloud realtime connection', async () => {
    const realtimeConnections = [
      { connect: vi.fn(), destroy: vi.fn() },
      { connect: vi.fn(), destroy: vi.fn() },
    ];
    const createTransport = vi.fn();
    const createRealtimeClient = vi
      .fn()
      .mockReturnValueOnce(realtimeConnections[0])
      .mockReturnValueOnce(realtimeConnections[1]);
    const runtime = new AgentRuntime(pairedConfig, {
      configManager: makeConfigStore(pairedConfig),
      createApiClient: () => ({}) as never,
      createRealtimeClient,
      createTransport,
    });

    await runtime.start();
    await runtime.reconnect();

    expect(realtimeConnections[0]!.destroy).toHaveBeenCalledOnce();
    expect(realtimeConnections[1]!.connect).toHaveBeenCalledOnce();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('enqueues the embedded realtime snapshot without fetching job detail and deduplicates events', async () => {
    const job = {
      id: 'JOB-1',
      storeId: 'STORE-1',
      targetDeviceId: null,
      printerRole: 'receipt',
      documentType: 'invoice',
      documentId: 'INV-1',
      idempotencyKey: 'print-job-1',
      status: 'QUEUED',
      requestedByUserId: null,
      requestedByDeviceId: null,
      claimedByDeviceId: null,
      createdAt: Date.now(),
      claimedAt: null,
      printingAt: null,
      completedAt: null,
      failedAt: null,
      attemptCount: 0,
      failureCode: null,
      failureMessage: null,
    } as const;
    const get = vi.fn();
    const client = new AgentRealtimeClient(pairedConfig, {
      get,
    } as never);
    const processJob = vi.fn(async () => true);
    (client as any).processor = { processJob };
    const event = {
      schemaVersion: 1,
      eventId: 'event-1',
      sequence: 1,
      type: 'pos.print_job.created',
      storeId: 'STORE-1',
      aggregate: { type: 'PRINT_JOB', id: 'JOB-1', version: 1 },
      occurredAtMs: Date.now(),
      actor: null,
      deviceId: null,
      clientMutationId: null,
      topics: ['pos.print_jobs'],
      data: {
        reason: 'PRINT_JOB_CREATED',
        printJobId: 'JOB-1',
        printJobStatus: 'QUEUED',
        printJob: job,
      },
    } as const;

    (client as any).handleMessage({ type: 'events', events: [event, event] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(processJob).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it('runs an immediate pending scan for a legacy realtime event without a snapshot', async () => {
    const job = {
      id: 'JOB-LEGACY',
      documentType: 'invoice',
      documentId: 'INV-LEGACY',
      status: 'QUEUED',
      targetDeviceId: null,
    };
    const get = vi.fn(async (path: string) => {
      if (path === '/api/v1/pos/print-jobs/pending?limit=50') {
        throw new Error('API GET pending failed (404): legacy server');
      }
      expect(path).toBe('/api/v1/pos/print-jobs?status=QUEUED&limit=20');
      return [job];
    });
    const client = new AgentRealtimeClient(pairedConfig, { get } as never);
    const processJob = vi.fn(async () => true);
    (client as any).processor = { processJob };

    (client as any).handleMessage({
      type: 'events',
      events: [
        {
          schemaVersion: 1,
          eventId: 'legacy-event',
          sequence: 1,
          type: 'pos.print_job.created',
          storeId: 'STORE-1',
          aggregate: { type: 'PRINT_JOB', id: 'JOB-LEGACY', version: 1 },
          occurredAtMs: Date.now(),
          actor: null,
          deviceId: null,
          clientMutationId: null,
          topics: ['pos.print_jobs'],
          data: {
            reason: 'PRINT_JOB_CREATED',
            printJobId: 'JOB-LEGACY',
            printJobStatus: 'QUEUED',
          },
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.map(([path]) => path)).not.toContain('/api/v1/pos/print-jobs/JOB-LEGACY');
    expect(processJob).toHaveBeenCalledOnce();
  });

  it('does not report connected until the server ready frame and immediate pending sync succeed', async () => {
    const onConnected = vi.fn();
    const post = vi.fn(async () => ({}));
    const get = vi.fn(async (path: string) => {
      if (path === '/api/v1/pos/print-jobs/pending?limit=50') {
        return { jobs: [], nextCursor: null };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const client = new AgentRealtimeClient(pairedConfig, { get, post } as never, { onConnected });

    (client as any).handleMessage({
      type: 'ready',
      connectionId: 'connection-1',
      serverNowMs: Date.now(),
      reauthAtMs: Date.now() + 60_000,
      schemaVersion: 1,
      sync: { mode: 'FULL_SYNC', cursor: 0, serverNowMs: Date.now(), reason: 'NO_CURSOR' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get).toHaveBeenCalledWith('/api/v1/pos/print-jobs/pending?limit=50');
    expect(onConnected).toHaveBeenCalledOnce();
    client.destroy();
  });

  it('single-flights overlapping pending scans', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const get = vi.fn(() => pending);
    const client = new AgentRealtimeClient(pairedConfig, { get } as never);

    const first = client.recoverPendingJobs();
    const second = client.recoverPendingJobs();
    release({ jobs: [], nextCursor: null });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(get).toHaveBeenCalledOnce();
    client.destroy();
  });

  it('scans immediately on disconnect mode and backs offline polling from 2s to 30s', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const get = vi.fn(async () => ({ jobs: [], nextCursor: null }));
    const client = new AgentRealtimeClient(pairedConfig, { get } as never);

    expect((client as any).nextPollDelay()).toBe(2_000);
    (client as any).offlinePollAttempt = 4;
    expect((client as any).nextPollDelay()).toBe(30_000);
    (client as any).offlinePollAttempt = 0;
    (client as any).startPollingFallback(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledOnce();

    client.destroy();
    random.mockRestore();
    vi.useRealTimers();
  });

  it('retries transient HTTP failures and honors Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(Response.json({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn(async () => undefined);
    const client = new AgentApiClient(pairedConfig, { sleep, random: () => 0.5 });

    await expect(client.get('/retry')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllGlobals();
  });

  it('does not retry authorization, not-found or conflict responses', async () => {
    for (const status of [401, 403, 404, 409]) {
      const fetchMock = vi.fn(async () => new Response('no', { status }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new AgentApiClient(pairedConfig, {
        sleep: vi.fn(async () => undefined),
      });
      await expect(client.post('/transition', {})).rejects.toMatchObject({
        status,
        retryable: false,
      } satisfies Partial<AgentApiError>);
      expect(fetchMock).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    }
  });

  it('retries a lost transition response with the same request body', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('socket reset'))
      .mockResolvedValueOnce(Response.json({ data: { status: 'COMPLETED' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new AgentApiClient(pairedConfig, {
      sleep: vi.fn(async () => undefined),
      random: () => 0.5,
    });
    const body = { claimToken: '11111111-1111-4111-8111-111111111111' };

    await expect(client.post('/complete', body)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(body));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(body));
    vi.unstubAllGlobals();
  });
});
