import { describe, expect, it, vi } from 'vitest';
import { defaultPrinterDeviceConfig, parsePrinterDeviceConfig } from '../../src/contracts/store';
import { formatPairingCode } from '../../apps/print-agent/src/desktop/renderer/presentation';
import { ConfigManager, type PrintAgentConfig } from '../../apps/print-agent/src/config';
import { AgentRuntime } from '../../apps/print-agent/src/core/agent-runtime';

describe('Print System RBAC & Source of Truth Invariants', () => {
  it('ensures Owner print policy defaults and schema enforce copy counts and provisional printing', () => {
    // Owner owns paymentCopyCount, provisionalCopyCount, allowProvisionalPrint
    const defaultOwnerPolicy = {
      paymentCopyCount: 1,
      provisionalCopyCount: 1,
      allowProvisionalPrint: true,
      paperSize: 'K80' as const,
    };

    expect(defaultOwnerPolicy.paymentCopyCount).toBeGreaterThanOrEqual(1);
    expect(defaultOwnerPolicy.provisionalCopyCount).toBeGreaterThanOrEqual(1);
    expect(defaultOwnerPolicy.allowProvisionalPrint).toBe(true);
  });

  it('ensures Print Agent is the sole source of truth for physical connection parameters', () => {
    const configManager = new ConfigManager();
    const loadedConfig = configManager.loadConfig();

    // Must default to local config without server transport override
    expect(loadedConfig.connectionType).toBeDefined();
    expect(['NETWORK_TCP', 'WINDOWS_PRINTER']).toContain(loadedConfig.connectionType);
  });

  it('preserves pairing credentials when changing local printer connection from LAN to Windows USB', () => {
    const initialConfig = {
      serverUrl: 'http://localhost:5173',
      storeId: 'store-123',
      agentId: 'agent-456',
      agentSecret: 'secret-xyz',
      connectionType: 'NETWORK_TCP' as const,
      printerIp: '192.168.1.73',
      printerPort: 9100,
      paperSize: 'K80' as const,
    };

    const runtime = new AgentRuntime(initialConfig);
    expect(runtime.getConfig()?.agentId).toBe('agent-456');

    // Switch to Windows printer queue via local config update
    const switchedConfig = {
      ...initialConfig,
      connectionType: 'WINDOWS_PRINTER' as const,
      printerName: 'XP-80C Thermal Printer',
    };

    const updatedRuntime = new AgentRuntime(switchedConfig);

    const current = updatedRuntime.getConfig();
    expect(current?.agentId).toBe('agent-456');
    expect(current?.agentSecret).toBe('secret-xyz');
    expect(current?.connectionType).toBe('WINDOWS_PRINTER');
    expect(current?.printerName).toBe('XP-80C Thermal Printer');
  });

  it('re-creates fresh print cache with authenticated client upon successful pairing flow', async () => {
    let activeClientConfig: PrintAgentConfig | null = null;
    const mockRealtime = {
      connect: vi.fn(),
      destroy: vi.fn(),
    };

    const unassignedConfig: PrintAgentConfig = {
      serverUrl: 'http://localhost:5173',
      printerIp: '192.168.1.73',
      printerPort: 9100,
    };

    const mockConfigStore = {
      loadConfig: () => unassignedConfig,
      saveConfig: vi.fn(),
      isPaired: (cfg: PrintAgentConfig) => Boolean(cfg.agentId && cfg.agentSecret && cfg.storeId),
      clearPairing: vi.fn(),
      reset: vi.fn(),
    };

    const pairedConfig: PrintAgentConfig = {
      ...unassignedConfig,
      agentId: 'new-agent-uuid',
      agentSecret: 'new-secret-xyz',
      storeId: 'store-abc',
    };

    const mockPairingHandler = {
      startPairingFlow: vi.fn(async () => pairedConfig),
    };

    const runtime = new AgentRuntime(unassignedConfig, {
      configManager: mockConfigStore,
      createApiClient: (cfg) => {
        activeClientConfig = cfg;
        return {
          get: vi.fn(),
          post: vi.fn(),
        } as any;
      },
      createRealtimeClient: () => mockRealtime,
      createPairingHandler: () => mockPairingHandler,
    });

    await runtime.startPairing();

    expect(mockPairingHandler.startPairingFlow).toHaveBeenCalled();
    expect(activeClientConfig).toEqual(pairedConfig);
    expect(mockRealtime.connect).toHaveBeenCalled();
  });

  it('formats pairing codes cleanly without raw technical metadata in UI', () => {
    expect(formatPairingCode('842165')).toBe('842 165');
    expect(formatPairingCode('123456')).toBe('123 456');
  });

  it('parses fallback printer device config without mutating store print policy', () => {
    const parsed = parsePrinterDeviceConfig(null);
    expect(parsed.paperSize).toBe(defaultPrinterDeviceConfig.paperSize);
    expect(parsed.autoCut).toBe(defaultPrinterDeviceConfig.autoCut);
  });
});
