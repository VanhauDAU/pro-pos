import { describe, expect, it } from 'vitest';
import type { AgentRuntimeState } from '../../apps/print-agent/src/core/agent-runtime';
import {
  formatPairingCode,
  presentCloudStatus,
  presentFriendlyError,
  presentOverallStatus,
  presentPrinterStatus,
} from '../../apps/print-agent/src/desktop/renderer/presentation';

const state = (
  status: AgentRuntimeState['status'],
  printer: AgentRuntimeState['printer'],
): AgentRuntimeState => ({
  status,
  printer,
  pairing: { code: null, expiresAt: null },
  lastError: null,
  updatedAt: 0,
});

describe('Print Agent desktop presentation', () => {
  it('maps runtime enums to friendly overall labels', () => {
    expect(presentOverallStatus(state('ONLINE', 'READY')).label).toBe('Sẵn sàng');
    expect(presentOverallStatus(state('ONLINE', 'UNKNOWN')).label).toBe(
      'Đã kết nối · Chưa kiểm tra máy in',
    );
    expect(presentOverallStatus(state('ONLINE', 'UNREACHABLE')).label).toBe('Máy in mất kết nối');
    expect(presentOverallStatus(state('CONNECTING', 'UNKNOWN')).label).toBe('Đang kết nối');
    expect(presentOverallStatus(state('DEGRADED', 'UNKNOWN')).label).toBe('Kết nối không ổn định');
    expect(presentOverallStatus(state('OFFLINE', 'UNKNOWN')).label).toBe('Mất kết nối');
  });

  it('keeps raw runtime and printer enums out of user-facing connection labels', () => {
    const runtime = state('ONLINE', 'UNKNOWN');
    expect(presentCloudStatus(runtime).label).toBe('Đã kết nối');
    expect(presentPrinterStatus(runtime).label).toBe('Chưa kiểm tra');
    expect(
      `${presentCloudStatus(runtime).label} ${presentPrinterStatus(runtime).label}`,
    ).not.toMatch(/ONLINE|UNKNOWN/);
  });

  it('maps technical fault states to actionable messages', () => {
    expect(presentFriendlyError(state('ONLINE', 'UNREACHABLE'))).toContain(
      'Kiểm tra nguồn, dây mạng',
    );
    expect(presentFriendlyError(state('ONLINE', 'INVALID_CONFIG'))).toBe(
      'Cấu hình máy in chưa hợp lệ.',
    );
    expect(presentFriendlyError(state('OFFLINE', 'UNKNOWN'))).toBe(
      'Print Agent đang mất kết nối máy chủ.',
    );
  });

  it('formats the six-digit pairing code for quick visual scanning', () => {
    expect(formatPairingCode('583214')).toBe('583 214');
  });
});
