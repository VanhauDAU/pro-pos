import { describe, expect, it } from 'vitest';
import type { AgentRuntimeState } from '../../apps/print-agent/src/core/agent-runtime';
import {
  formatPairingCode,
  presentCloudStatus,
  presentFriendlyError,
  presentOverallStatus,
  presentPrinterErrorDetails,
  presentPrinterStatus,
  presentUpdateStatus,
} from '../../apps/print-agent/src/desktop/renderer/presentation';
import { requestPrinterCheck } from '../../apps/print-agent/src/desktop/renderer/printer-actions';
import { vi } from 'vitest';

const state = (
  status: AgentRuntimeState['status'],
  printer: AgentRuntimeState['printer'],
): AgentRuntimeState => ({
  status,
  printer,
  pairing: { code: null, expiresAt: null },
  lastError: null,
  printerDiagnostics: null,
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

  it('maps update states to friendly presentation objects', () => {
    expect(presentUpdateStatus(null).label).toBe('Không khả dụng');
    expect(presentUpdateStatus({ status: 'DISABLED', currentVersion: '0.5.0' }).tone).toBe(
      'neutral',
    );
    expect(presentUpdateStatus({ status: 'CHECKING', currentVersion: '0.5.0' }).label).toBe(
      'Đang kiểm tra...',
    );
    expect(
      presentUpdateStatus({
        status: 'AVAILABLE',
        currentVersion: '0.5.0',
        availableVersion: '0.5.1',
      }).label,
    ).toBe('Có bản mới v0.5.1');
    expect(
      presentUpdateStatus({
        status: 'DOWNLOADING',
        currentVersion: '0.5.0',
        availableVersion: '0.5.1',
        progressPercent: 55,
      }).label,
    ).toContain('55%');
    expect(
      presentUpdateStatus({
        status: 'DOWNLOADED',
        currentVersion: '0.5.0',
        availableVersion: '0.5.1',
      }).label,
    ).toContain('sẵn sàng');
    expect(
      presentUpdateStatus({
        status: 'WAITING_FOR_IDLE',
        currentVersion: '0.5.0',
        availableVersion: '0.5.1',
      }).tone,
    ).toBe('warning');
    expect(presentUpdateStatus({ status: 'UP_TO_DATE', currentVersion: '0.5.0' }).label).toBe(
      'Phiên bản mới nhất',
    );
    expect(
      presentUpdateStatus({
        status: 'ERROR',
        currentVersion: '0.5.0',
        errorMessage: 'Network error',
      }).label,
    ).toBe('Cập nhật thất bại');
  });

  it('formats the six-digit pairing code for quick visual scanning', () => {
    expect(formatPairingCode('583214')).toBe('583 214');
  });

  it('formats whitelisted TCP diagnostics for the details disclosure', () => {
    expect(
      presentPrinterErrorDetails('connect EHOSTUNREACH', {
        errorCode: 'EHOSTUNREACH',
        printerCode: 'NETWORK_PRINTER_UNREACHABLE',
        host: '192.168.1.73',
        port: 9100,
        failureStage: 'BEFORE_WRITE',
        localAddress: '192.168.1.144',
      }),
    ).toBe(
      [
        'message: connect EHOSTUNREACH',
        'errorCode: EHOSTUNREACH',
        'printerCode: NETWORK_PRINTER_UNREACHABLE',
        'host: 192.168.1.73',
        'port: 9100',
        'failureStage: BEFORE_WRITE',
        'localAddress: 192.168.1.144',
      ].join('\n'),
    );
  });

  it('routes printer recheck to testPrinter, never cloud reconnect', async () => {
    const testPrinter = vi.fn(async () => ({
      ok: true,
      host: '192.168.1.73',
      port: 9100,
    }));
    const reconnect = vi.fn();
    const api = { testPrinter, reconnect };

    await requestPrinterCheck(api);

    expect(testPrinter).toHaveBeenCalledOnce();
    expect(reconnect).not.toHaveBeenCalled();
  });
});
