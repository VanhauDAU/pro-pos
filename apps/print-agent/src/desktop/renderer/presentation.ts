import type { AgentRuntimeState, PrinterTestResult } from '../../core/agent-runtime';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export interface PresentedStatus {
  label: string;
  description: string;
  tone: StatusTone;
}

export function presentOverallStatus(state: AgentRuntimeState): PresentedStatus {
  if (state.status === 'ONLINE' && state.printer === 'READY') {
    return {
      label: 'Sẵn sàng',
      description: 'Print Agent và máy in đang hoạt động bình thường.',
      tone: 'success',
    };
  }
  if (state.status === 'ONLINE' && state.printer === 'UNREACHABLE') {
    return {
      label: 'Máy in mất kết nối',
      description: 'Máy chủ vẫn kết nối, nhưng chưa thể gửi dữ liệu tới máy in.',
      tone: 'danger',
    };
  }
  if (state.status === 'ONLINE' && state.printer === 'INVALID_CONFIG') {
    return {
      label: 'Cần cấu hình máy in',
      description: 'Kiểm tra lại địa chỉ IP và cổng máy in.',
      tone: 'danger',
    };
  }
  if (state.status === 'ONLINE') {
    return {
      label: 'Đã kết nối · Chưa kiểm tra máy in',
      description: 'Hãy in thử để xác nhận kết nối tới máy in.',
      tone: 'info',
    };
  }
  if (state.status === 'CONNECTING') {
    return {
      label: 'Đang kết nối',
      description: 'Print Agent đang kết nối an toàn tới máy chủ PRO POS.',
      tone: 'info',
    };
  }
  if (state.status === 'AUTHENTICATING') {
    return {
      label: 'Đang xác thực',
      description: 'Đang xác thực Print Agent với máy chủ.',
      tone: 'info',
    };
  }
  if (state.status === 'REGISTERED' || state.status === 'SUBSCRIBED') {
    return {
      label: 'Đang đăng ký nhận lệnh',
      description: 'Đang đăng ký kênh lệnh in của cửa hàng.',
      tone: 'info',
    };
  }
  if (state.status === 'SYNCING') {
    return {
      label: 'Đang đồng bộ lệnh in',
      description: 'Đang kiểm tra các lệnh chưa xử lý.',
      tone: 'info',
    };
  }
  if (state.status === 'DEGRADED') {
    return {
      label: 'Kết nối không ổn định',
      description: 'Print Agent đang tự khôi phục kết nối.',
      tone: 'warning',
    };
  }
  if (state.status === 'OFFLINE') {
    return {
      label: 'Mất kết nối',
      description: 'Kiểm tra Internet; Print Agent sẽ tiếp tục tự kết nối lại.',
      tone: 'danger',
    };
  }
  return { label: 'Đang khởi động', description: 'Vui lòng đợi trong giây lát.', tone: 'neutral' };
}

export function presentCloudStatus(state: AgentRuntimeState): PresentedStatus {
  if (state.status === 'ONLINE')
    return { label: 'Đã kết nối', description: 'Máy chủ PRO POS', tone: 'success' };
  if (state.status === 'CONNECTING')
    return { label: 'Đang kết nối', description: 'Máy chủ PRO POS', tone: 'info' };
  if (['AUTHENTICATING', 'REGISTERED', 'SUBSCRIBED', 'SYNCING'].includes(state.status))
    return {
      label: 'Đang chuẩn bị',
      description: 'Đang xác thực và đồng bộ lệnh in',
      tone: 'info',
    };
  if (state.status === 'DEGRADED')
    return { label: 'Không ổn định', description: 'Đang tự khôi phục', tone: 'warning' };
  return { label: 'Mất kết nối', description: 'Máy chủ PRO POS', tone: 'danger' };
}

export function presentPrinterStatus(state: AgentRuntimeState): PresentedStatus {
  if (state.printer === 'READY')
    return { label: 'Sẵn sàng', description: 'Kết nối LAN · TCP', tone: 'success' };
  if (state.printer === 'UNREACHABLE')
    return {
      label: 'Không thể kết nối',
      description: 'Kiểm tra máy in và mạng LAN',
      tone: 'danger',
    };
  if (state.printer === 'INVALID_CONFIG')
    return { label: 'Cấu hình chưa hợp lệ', description: 'Kiểm tra IP và cổng', tone: 'danger' };
  return { label: 'Chưa kiểm tra', description: 'Kết nối LAN · TCP', tone: 'neutral' };
}

export function presentFriendlyError(state: AgentRuntimeState): string | null {
  if (state.printer === 'UNREACHABLE') {
    return 'Không thể kết nối máy in. Kiểm tra nguồn, dây mạng hoặc địa chỉ IP.';
  }
  if (state.printer === 'INVALID_CONFIG') return 'Cấu hình máy in chưa hợp lệ.';
  if (state.status === 'OFFLINE' || state.status === 'DEGRADED') {
    return 'Print Agent đang mất kết nối máy chủ.';
  }
  return null;
}

export function presentPrinterErrorDetails(
  error: string | null | undefined,
  diagnostics: PrinterTestResult['diagnostics'],
): string | null {
  if (!error && !diagnostics) return null;
  const lines = error ? [`message: ${error}`] : [];
  if (diagnostics) {
    lines.push(`errorCode: ${diagnostics.errorCode}`);
    if (diagnostics.printerCode && diagnostics.printerCode !== diagnostics.errorCode) {
      lines.push(`printerCode: ${diagnostics.printerCode}`);
    }
    lines.push(`host: ${diagnostics.host}`);
    lines.push(`port: ${diagnostics.port}`);
    lines.push(`failureStage: ${diagnostics.failureStage}`);
    if (diagnostics.localAddress) lines.push(`localAddress: ${diagnostics.localAddress}`);
    if (diagnostics.localPort) lines.push(`localPort: ${diagnostics.localPort}`);
  }
  return lines.join('\n');
}

export function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}
