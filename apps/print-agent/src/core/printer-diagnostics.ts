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

export function mapPrinterErrorDiagnostics(
  error: unknown,
  host: string,
  port: number,
): PrinterErrorDiagnostics {
  const printerError = error instanceof PrinterError ? error : null;
  const outer = asNetworkErrorLike(error);
  const cause = asNetworkErrorLike(error instanceof Error ? error.cause : null);
  const systemCode = cause?.code ?? (printerError ? undefined : outer?.code);
  const localAddress = printerError?.localAddress ?? cause?.localAddress ?? outer?.localAddress;
  const localPort = printerError?.localPort ?? cause?.localPort ?? outer?.localPort;

  return {
    errorCode:
      typeof systemCode === 'string' ? systemCode : (printerError?.code ?? 'UNKNOWN_PRINTER_ERROR'),
    ...(printerError ? { printerCode: printerError.code } : {}),
    host,
    port,
    failureStage: printerError?.failureStage ?? 'BEFORE_WRITE',
    ...(typeof localAddress === 'string' && localAddress ? { localAddress } : {}),
    ...(typeof localPort === 'number' && Number.isInteger(localPort) ? { localPort } : {}),
  };
}
