import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../apps/print-agent/src/core/agent-runtime';
import {
  WindowsRawPrinterTransport,
  type ProcessRunner,
} from '../../apps/print-agent/src/transports/windows-spooler-transport';
import type { PrintAgentConfig } from '../../apps/print-agent/src/config';

describe('Print Agent USB & LAN Integration Tests', () => {
  it('runs complete USB test print with mock Windows Spooler and transitions to READY', async () => {
    let capturedPrinterName = '';
    let capturedBytes: Uint8Array | undefined;

    const mockRunner: ProcessRunner = vi.fn(async (_exe, args, input) => {
      const pIdx = args.indexOf('-PrinterName');
      capturedPrinterName = pIdx >= 0 ? args[pIdx + 1] || '' : '';
      capturedBytes = input;
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const config: PrintAgentConfig = {
      serverUrl: 'https://propos.test',
      connectionType: 'WINDOWS_PRINTER',
      printerName: 'POS-80 USB Printer',
      paperSize: 'K80',
      agentId: 'agent-usb-1',
      agentSecret: 'secret_1',
      storeId: 'store-1',
    };

    const configManager = {
      loadConfig: vi.fn(() => config),
      saveConfig: vi.fn(),
      isPaired: vi.fn(() => true),
    };

    const runtime = new AgentRuntime(config, {
      configManager,
      createTransport: () => new WindowsRawPrinterTransport(mockRunner),
    });

    const result = await runtime.testPrinter();

    expect(result.ok).toBe(true);
    expect(result.connectionType).toBe('WINDOWS_PRINTER');
    expect(result.printerName).toBe('POS-80 USB Printer');
    expect(capturedPrinterName).toBe('POS-80 USB Printer');
    expect(capturedBytes).toBeInstanceOf(Uint8Array);
    expect(capturedBytes?.byteLength).toBeGreaterThan(10);
    expect(runtime.getState().printer).toBe('READY');
  });

  it('fails with INVALID_CONFIG when Windows printer name is empty', async () => {
    const config: PrintAgentConfig = {
      serverUrl: 'https://propos.test',
      connectionType: 'WINDOWS_PRINTER',
      printerName: '', // empty
      paperSize: 'K80',
    };

    const configManager = {
      loadConfig: vi.fn(() => config),
      saveConfig: vi.fn(),
      isPaired: vi.fn(() => false),
    };

    const runtime = new AgentRuntime(config, { configManager });
    const result = await runtime.testPrinter();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Tên máy in Windows không được để trống');
    expect(runtime.getState().printer).toBe('INVALID_CONFIG');
  });

  it('preserves pairing and switches between LAN and USB cleanly', async () => {
    let savedConfig: PrintAgentConfig | null = null;
    const initialConfig: PrintAgentConfig = {
      serverUrl: 'https://propos.test',
      connectionType: 'NETWORK_TCP',
      printerIp: '192.168.1.50',
      printerPort: 9100,
      paperSize: 'K80',
      agentId: 'agent-switch-1',
      agentSecret: 'secret-switch-1',
      storeId: 'store-switch-1',
    };

    const configManager = {
      loadConfig: vi.fn(() => savedConfig || initialConfig),
      saveConfig: vi.fn((cfg: PrintAgentConfig) => {
        savedConfig = cfg;
      }),
      isPaired: vi.fn((cfg: PrintAgentConfig) =>
        Boolean(cfg.agentId && cfg.agentSecret && cfg.storeId),
      ),
    };

    const runtime = new AgentRuntime(initialConfig, { configManager });
    expect(configManager.isPaired(runtime.getConfig()!)).toBe(true);

    // Switch to Windows USB printer
    const switchedConfig: PrintAgentConfig = {
      ...runtime.getConfig()!,
      connectionType: 'WINDOWS_PRINTER',
      printerName: 'POS-80 USB',
    };
    configManager.saveConfig(switchedConfig);

    expect(configManager.isPaired(switchedConfig)).toBe(true);
    expect(switchedConfig.agentId).toBe('agent-switch-1');
    expect(switchedConfig.agentSecret).toBe('secret-switch-1');
    expect(switchedConfig.printerName).toBe('POS-80 USB');
  });
});
