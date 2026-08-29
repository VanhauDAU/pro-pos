import qz from 'qz-tray';

import { PrinterConnectionError, PrinterError } from '../printer-errors';
import type { PrinterConfig } from '../printer-types';
import { withQzReconnect } from './qz-client';

const PRINT_TIMEOUT_MS = 12_000;

function withPrintTimeout(promise: Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error('QZ print timeout')),
      PRINT_TIMEOUT_MS,
    );
    promise.then(
      () => {
        globalThis.clearTimeout(timer);
        resolve();
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function qzPrintRaw(
  printer: PrinterConfig,
  payload: Uint8Array,
  jobName = 'Pro POS Receipt',
) {
  const target =
    printer.connectionType === 'NETWORK_TCP'
      ? { host: printer.networkIp!.trim(), port: Number(printer.networkPort ?? 9100) }
      : printer.printerName!.trim();

  const config = qz.configs.create(target as never, {
    copies: 1,
    jobName,
    // Base64 command data is already byte-perfect; QZ must not transcode it.
    encoding: null as never,
  });

  try {
    await withQzReconnect(() =>
      withPrintTimeout(
        qz.print(config, [
          {
            type: 'raw',
            format: 'command',
            flavor: 'base64',
            data: bytesToBase64(payload),
          },
        ]),
      ),
    );
  } catch (error) {
    if (error instanceof PrinterError) throw error;

    const detail = error instanceof Error ? error.message : String(error);
    const lower = detail.toLowerCase();

    if (import.meta.env.DEV) {
      console.error('[QZ] print raw error:', detail, error);
    }

    if (/sign|certificate|algorithm|crypto/i.test(lower)) {
      throw new PrinterError('QZ_CONNECTION_FAILED', `Lỗi xác thực chứng chỉ QZ Tray: ${detail}`, {
        cause: error,
      });
    }

    if (/websocket|not connected|connection lost|closed/i.test(lower)) {
      throw new PrinterConnectionError(`Mất kết nối QZ Tray: ${detail}`, { cause: error });
    }

    if (printer.connectionType === 'NETWORK_TCP') {
      if (/refused|econnrefused|unreachable|timeout|no route|cannot connect/i.test(lower)) {
        throw new PrinterError(
          'NETWORK_PRINTER_UNREACHABLE',
          `Máy in LAN ${printer.networkIp}:${printer.networkPort ?? 9100} không phản hồi.`,
          { cause: error },
        );
      }
    }

    if (/offline|not available|unavailable|paused/.test(lower)) {
      throw new PrinterError('PRINTER_OFFLINE', undefined, { cause: error });
    }

    throw new PrinterError('PRINT_FAILED', `In thất bại: ${detail}`, { cause: error });
  }
}
