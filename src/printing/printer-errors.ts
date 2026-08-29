export type PrinterErrorCode =
  | 'AGENT_OFFLINE'
  | 'PRINTER_OFFLINE'
  | 'NETWORK_PRINTER_UNREACHABLE'
  | 'PRINT_FAILED'
  | 'RENDER_FAILED'
  | 'INVALID_PRINTER_CONFIG'
  | 'CONNECTION_TIMEOUT'
  | 'SOCKET_WRITE_ERROR';

const DEFAULT_MESSAGES: Record<PrinterErrorCode, string> = {
  AGENT_OFFLINE: 'Print Agent tại quầy đang ngoại tuyến. Vui lòng kiểm tra máy tính quầy.',
  PRINTER_OFFLINE: 'Máy in đang ngoại tuyến. Vui lòng kiểm tra nguồn và kết nối cáp mạng.',
  NETWORK_PRINTER_UNREACHABLE: 'Không thể kết nối tới địa chỉ IP máy in LAN (cổng 9100).',
  PRINT_FAILED: 'In thất bại. Vui lòng kiểm tra giấy hoặc kết nối máy in.',
  RENDER_FAILED: 'Không thể tạo hình ảnh hóa đơn để in.',
  INVALID_PRINTER_CONFIG: 'Cấu hình máy in không hợp lệ.',
  CONNECTION_TIMEOUT: 'Quá thời gian kết nối tới máy in (Timeout).',
  SOCKET_WRITE_ERROR: 'Lỗi gửi dữ liệu ESC/POS tới socket máy in.',
};

export class PrinterError extends Error {
  readonly code: PrinterErrorCode;

  constructor(code: PrinterErrorCode, message = DEFAULT_MESSAGES[code], options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrinterError';
    this.code = code;
  }
}

export class PrinterConnectionError extends PrinterError {
  constructor(message = DEFAULT_MESSAGES.NETWORK_PRINTER_UNREACHABLE, options?: ErrorOptions) {
    super('NETWORK_PRINTER_UNREACHABLE', message, options);
    this.name = 'PrinterConnectionError';
  }
}

export function asPrinterError(error: unknown, fallback: PrinterErrorCode = 'PRINT_FAILED') {
  if (error instanceof PrinterError) return error;
  return new PrinterError(fallback, DEFAULT_MESSAGES[fallback], { cause: error });
}
