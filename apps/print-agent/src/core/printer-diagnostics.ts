import { PrinterError } from '@printing/printer-errors';
import type { PrinterErrorDiagnostics } from './agent-state';

interface NetworkErrorLike {
  code?: unknown;
  localAddress?: unknown;
  localPort?: unknown;
}

function asNetworkErrorLike(value: unknown): NetworkErrorLike | null {
  return value && typeof value === 'object' ? (value as NetworkErrorLike) : null;
}

export interface PrinterDiagnosticsConnectionInfo {
  connectionType?: 'NETWORK_TCP' | 'WINDOWS_PRINTER';
  host?: string;
  port?: number;
  printerName?: string;
}

export function mapPrinterErrorDiagnostics(
  error: unknown,
  connectionOrHost: PrinterDiagnosticsConnectionInfo | string,
  legacyPort?: number,
): PrinterErrorDiagnostics {
  const printerError = error instanceof PrinterError ? error : null;
  const outer = asNetworkErrorLike(error);
  const cause = asNetworkErrorLike(error instanceof Error ? error.cause : null);
  const systemCode = cause?.code ?? (printerError ? undefined : outer?.code);
  const localAddress = printerError?.localAddress ?? cause?.localAddress ?? outer?.localAddress;
  const localPort = printerError?.localPort ?? cause?.localPort ?? outer?.localPort;

  const isLegacy = typeof connectionOrHost === 'string';
  const connectionType = isLegacy
    ? 'NETWORK_TCP'
    : connectionOrHost.connectionType || 'NETWORK_TCP';
  const host = isLegacy ? connectionOrHost : connectionOrHost.host;
  const port = isLegacy ? legacyPort : connectionOrHost.port;
  const printerName = isLegacy ? undefined : connectionOrHost.printerName;

  return {
    errorCode:
      typeof systemCode === 'string' ? systemCode : (printerError?.code ?? 'UNKNOWN_PRINTER_ERROR'),
    ...(printerError ? { printerCode: printerError.code } : {}),
    connectionType,
    ...(host ? { host } : {}),
    ...(typeof port === 'number' && Number.isInteger(port) ? { port } : {}),
    ...(printerName ? { printerName } : {}),
    failureStage: printerError?.failureStage ?? 'BEFORE_WRITE',
    ...(typeof localAddress === 'string' && localAddress ? { localAddress } : {}),
    ...(typeof localPort === 'number' && Number.isInteger(localPort) ? { localPort } : {}),
  };
}
