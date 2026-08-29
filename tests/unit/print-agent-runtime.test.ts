import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../apps/print-agent/src/core/agent-runtime';
import type { PrintAgentConfig } from '../../apps/print-agent/src/config';
import { AgentRealtimeClient } from '../../apps/print-agent/src/realtime-client';

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
    isPaired: (candidate: PrintAgentConfig) => Boolean(candidate.agentId && candidate.agentSecret && candidate.storeId),
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
  });

  it('deduplicates the same job delivered by websocket and recovery before it reaches the queue', async () => {
    const client = new AgentRealtimeClient(pairedConfig, {} as never);
    const processJob = vi.fn(async () => true);
    (client as any).processor = { processJob };
    const job = { id: 'JOB-1', documentType: 'invoice', documentId: 'INV-1' };

    (client as any).handleMessage({ type: 'print_job.created', payload: job });
    (client as any).handleMessage({ type: 'print_job.created', payload: job });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(processJob).toHaveBeenCalledOnce();
  });
});
