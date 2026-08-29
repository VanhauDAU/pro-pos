export type PrinterErrorCode =
  | 'QZ_NOT_RUNNING'
  | 'QZ_CONNECTION_FAILED'
  | 'PRINTER_NOT_FOUND'
  | 'PRINTER_OFFLINE'
  | 'NETWORK_PRINTER_UNREACHABLE'
  | 'PRINT_FAILED'
  | 'RENDER_FAILED'
  | 'INVALID_PRINTER_CONFIG';

const DEFAULT_MESSAGES: Record<PrinterErrorCode, string> = {
  QZ_NOT_RUNNING: 'Không thể kết nối QZ Tray. Vui lòng mở QZ Tray rồi thử lại.',
  QZ_CONNECTION_FAILED: 'Không thể kết nối QZ Tray.',
  PRINTER_NOT_FOUND: 'Không tìm thấy máy in đã chọn.',
  PRINTER_OFFLINE: 'Máy in đang ngoại tuyến. Vui lòng kiểm tra nguồn và kết nối.',
  NETWORK_PRINTER_UNREACHABLE: 'Máy in LAN không phản hồi.',
  PRINT_FAILED: 'In thất bại. Vui lòng kiểm tra giấy hoặc kết nối máy in.',
  RENDER_FAILED: 'Không thể tạo hình ảnh hóa đơn để in.',
  INVALID_PRINTER_CONFIG: 'Cấu hình máy in không hợp lệ.',
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
  constructor(message = DEFAULT_MESSAGES.QZ_NOT_RUNNING, options?: ErrorOptions) {
    super('QZ_NOT_RUNNING', message, options);
    this.name = 'PrinterConnectionError';
  }
}

export function asPrinterError(error: unknown, fallback: PrinterErrorCode = 'PRINT_FAILED') {
  if (error instanceof PrinterError) return error;
  return new PrinterError(fallback, DEFAULT_MESSAGES[fallback], { cause: error });
}
