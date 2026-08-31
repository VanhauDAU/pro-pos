import type { AgentRuntimeState, PrinterTestResult } from '../../core/agent-runtime';
import type { DesktopAgentConfig, DesktopUpdateState } from '../shared/desktop-api';

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
      description: 'Kiểm tra lại cấu hình kết nối máy in.',
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

export function presentCloudStatus(
  state: AgentRuntimeState,
  storeName?: string | null,
): PresentedStatus {
  if (state.status === 'ONLINE')
    return { label: 'Đã kết nối', description: storeName || 'Máy chủ PRO POS', tone: 'success' };
  if (state.status === 'CONNECTING')
    return { label: 'Đang kết nối', description: storeName || 'Máy chủ PRO POS', tone: 'info' };
  if (['AUTHENTICATING', 'REGISTERED', 'SUBSCRIBED', 'SYNCING'].includes(state.status))
    return {
      label: 'Đang chuẩn bị',
      description: 'Đang xác thực và đồng bộ lệnh in',
      tone: 'info',
    };
  if (state.status === 'DEGRADED')
    return { label: 'Không ổn định', description: 'Đang tự khôi phục', tone: 'warning' };
  return { label: 'Mất kết nối', description: storeName || 'Máy chủ PRO POS', tone: 'danger' };
}

export function presentPrinterStatus(
  state: AgentRuntimeState,
  config?: DesktopAgentConfig,
): PresentedStatus {
  const isWindows = config?.connectionType === 'WINDOWS_PRINTER';
  const paperSize = config?.paperSize || 'K80';
  const connectionDesc = isWindows
    ? `${config?.printerName || 'Chưa chọn máy in'} · USB · Windows · ${paperSize}`
    : `${config?.printerIp || '192.168.1.73'}:${config?.printerPort || 9100} · LAN · ${paperSize}`;

  if (state.printer === 'READY') {
    return { label: 'Sẵn sàng', description: connectionDesc, tone: 'success' };
  }
  if (state.printer === 'UNREACHABLE') {
    return {
      label: 'Không thể kết nối',
      description: isWindows ? 'Kiểm tra cáp USB và nguồn máy in' : 'Kiểm tra máy in và mạng LAN',
      tone: 'danger',
    };
  }
  if (state.printer === 'INVALID_CONFIG') {
    return {
      label: 'Cấu hình chưa hợp lệ',
      description: isWindows ? 'Vui lòng chọn máy in' : 'Kiểm tra IP và cổng',
      tone: 'danger',
    };
  }
  return { label: 'Chưa kiểm tra', description: connectionDesc, tone: 'neutral' };
}

export function presentFriendlyError(state: AgentRuntimeState): string | null {
  if (state.printer === 'UNREACHABLE') {
    const diag = state.printerDiagnostics;
    if (diag?.connectionType === 'WINDOWS_PRINTER') {
      return 'Không tìm thấy máy in đã chọn. Kiểm tra nguồn, dây USB hoặc chọn lại máy in.';
    }
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
    if (diagnostics.connectionType) lines.push(`connectionType: ${diagnostics.connectionType}`);
    if (diagnostics.printerName) lines.push(`printerName: ${diagnostics.printerName}`);
    if (diagnostics.host) lines.push(`host: ${diagnostics.host}`);
    if (diagnostics.port) lines.push(`port: ${diagnostics.port}`);
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

export function presentUpdateStatus(updateState?: DesktopUpdateState | null): PresentedStatus {
  if (!updateState || updateState.status === 'DISABLED') {
    return {
      label: 'Không khả dụng',
      description: updateState?.errorMessage || 'Bản Portable không hỗ trợ cập nhật tự động.',
      tone: 'neutral',
    };
  }
  if (updateState.status === 'CHECKING') {
    return {
      label: 'Đang kiểm tra...',
      description: 'Đang kiểm tra phiên bản mới từ máy chủ cập nhật.',
      tone: 'info',
    };
  }
  if (updateState.status === 'AVAILABLE') {
    return {
      label: `Có bản mới v${updateState.availableVersion || ''}`,
      description: 'Chuẩn bị tải bản cập nhật...',
      tone: 'info',
    };
  }
  if (updateState.status === 'DOWNLOADING') {
    return {
      label: `Đang tải bản v${updateState.availableVersion || ''} (${updateState.progressPercent ?? 0}%)`,
      description: 'Đang tải bản cập nhật ngầm, Print Agent vẫn in bình thường.',
      tone: 'info',
    };
  }
  if (updateState.status === 'DOWNLOADED') {
    return {
      label: `Bản v${updateState.availableVersion} đã sẵn sàng`,
      description: 'Nhấn Cập nhật & khởi động lại để hoàn tất nâng cấp.',
      tone: 'success',
    };
  }
  if (updateState.status === 'WAITING_FOR_IDLE') {
    return {
      label: 'Đang đợi lệnh in hoàn tất',
      description: 'Đang hoàn tất lệnh in trước khi khởi động lại.',
      tone: 'warning',
    };
  }
  if (updateState.status === 'INSTALLING') {
    return {
      label: 'Đang cài đặt',
      description: 'Đang đóng ứng dụng để nâng cấp phiên bản mới...',
      tone: 'info',
    };
  }
  if (updateState.status === 'ERROR') {
    return {
      label: 'Cập nhật thất bại',
      description: updateState.errorMessage || 'Không thể tải bản cập nhật.',
      tone: 'danger',
    };
  }
  return {
    label: 'Phiên bản mới nhất',
    description: `Bạn đang sử dụng phiên bản PRO POS Print Agent v${updateState.currentVersion}.`,
    tone: 'success',
  };
}
