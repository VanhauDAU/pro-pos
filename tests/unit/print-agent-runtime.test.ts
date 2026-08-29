import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../apps/print-agent/src/core/agent-runtime';
import type { PrintAgentConfig } from '../../apps/print-agent/src/config';
import { AgentRealtimeClient } from '../../apps/print-agent/src/realtime-client';
import { PrinterError } from '../../src/printing/printer-errors';

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

  it('loads a realtime job from the canonical API and deduplicates duplicate events', async () => {
    const job = { id: 'JOB-1', documentType: 'invoice', documentId: 'INV-1', status: 'QUEUED' };
    const client = new AgentRealtimeClient(pairedConfig, {
      get: vi.fn(async () => job),
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
      data: { reason: 'PRINT_JOB_CREATED', printJobId: 'JOB-1', printJobStatus: 'QUEUED' },
    } as const;

    (client as any).handleMessage({ type: 'events', events: [event, event] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(processJob).toHaveBeenCalledOnce();
  });

  it('does not report connected until the server ready frame and immediate pending sync succeed', async () => {
    const onConnected = vi.fn();
    const get = vi.fn(async () => []);
    const client = new AgentRealtimeClient(pairedConfig, { get } as never, { onConnected });

    (client as any).handleMessage({
      type: 'ready',
      connectionId: 'connection-1',
      serverNowMs: Date.now(),
      reauthAtMs: Date.now() + 60_000,
      schemaVersion: 1,
      sync: { mode: 'FULL_SYNC', cursor: 0, serverNowMs: Date.now(), reason: 'NO_CURSOR' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get).toHaveBeenCalledWith('/api/v1/pos/print-jobs?status=QUEUED&limit=20');
    expect(onConnected).toHaveBeenCalledOnce();
    client.destroy();
  });
});
