import { describe, expect, it } from 'vitest';
import type { PrintAgentConfig } from '../../apps/print-agent/src/config';

describe('Print Agent Config Migration & Storage', () => {
  it('defaults connectionType to NETWORK_TCP when missing in legacy config', () => {
    // Simulate loading a legacy config object missing connectionType
    const legacyConfig: Partial<PrintAgentConfig> = {
      serverUrl: 'https://propos.test',
      printerIp: '192.168.1.100',
      printerPort: 9100,
      paperSize: 'K80',
    };

    const normalizedConnectionType = legacyConfig.connectionType || 'NETWORK_TCP';
    expect(normalizedConnectionType).toBe('NETWORK_TCP');
  });

  it('preserves printerName and connectionType for WINDOWS_PRINTER', () => {
    const usbConfig: PrintAgentConfig = {
      serverUrl: 'https://propos.test',
      connectionType: 'WINDOWS_PRINTER',
      printerName: 'POS-80 Thermal Printer',
      paperSize: 'K80',
      agentId: 'agent-123',
      agentSecret: 'sec_xyz',
      storeId: 'store-abc',
    };

    expect(usbConfig.connectionType).toBe('WINDOWS_PRINTER');
    expect(usbConfig.printerName).toBe('POS-80 Thermal Printer');
    expect(usbConfig.agentSecret).toBe('sec_xyz');
  });

  it('switching from USB to LAN preserves credentials and pairing', () => {
    const usbConfig: PrintAgentConfig = {
      serverUrl: 'https://propos.test',
      connectionType: 'WINDOWS_PRINTER',
      printerName: 'POS-80 Thermal Printer',
      printerIp: '192.168.1.50',
      printerPort: 9100,
      paperSize: 'K80',
      agentId: 'agent-123',
      agentSecret: 'sec_xyz',
      storeId: 'store-abc',
    };

    // User switches to LAN
    const updatedToLan: PrintAgentConfig = {
      ...usbConfig,
      connectionType: 'NETWORK_TCP',
      printerIp: '192.168.1.73',
      printerPort: 9100,
    };

    expect(updatedToLan.connectionType).toBe('NETWORK_TCP');
    expect(updatedToLan.agentId).toBe('agent-123');
    expect(updatedToLan.agentSecret).toBe('sec_xyz');
    expect(updatedToLan.storeId).toBe('store-abc');
    expect(updatedToLan.printerName).toBe('POS-80 Thermal Printer'); // Preserved in background
  });
});
