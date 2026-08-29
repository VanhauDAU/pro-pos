import * as net from 'node:net';
import { PrinterError } from '../printer-errors';
import type { PrinterConfig } from '../printer-types';
import type { PrintTransport } from './print-transport';

export interface TcpTransportOptions {
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export class TcpEscPosTransport implements PrintTransport {
  private readonly connectTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(options?: TcpTransportOptions) {
    this.connectTimeoutMs = options?.connectTimeoutMs ?? 5_000;
    this.writeTimeoutMs = options?.writeTimeoutMs ?? 10_000;
  }

  async print(data: Uint8Array, config: PrinterConfig): Promise<void> {
    const host = config.networkIp?.trim();
    const port = config.networkPort ?? 9100;

    if (!host) {
      throw new PrinterError(
        'INVALID_PRINTER_CONFIG',
        'Địa chỉ IP máy in LAN không được để trống.',
      );
    }

    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let hasStartedWriting = false;
      let isSettled = false;

      const cleanup = () => {
        socket.removeAllListeners();
        if (!socket.destroyed) {
          socket.destroy();
        }
      };

      const fail = (error: Error) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        reject(error);
      };

      const succeed = () => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve();
      };

      socket.setTimeout(this.connectTimeoutMs);

      socket.on('timeout', () => {
        if (!hasStartedWriting) {
          fail(
            new PrinterError(
              'CONNECTION_TIMEOUT',
              `Quá thời gian kết nối tới máy in LAN (${host}:${port}).`,
              { failureStage: 'BEFORE_WRITE' },
            ),
          );
        } else {
          fail(
            new PrinterError(
              'SOCKET_WRITE_ERROR',
              `Quá thời gian truyền dữ liệu in tới máy in (${host}:${port}).`,
              { failureStage: 'DURING_WRITE' },
            ),
          );
        }
      });

      socket.on('error', (err) => {
        if (!hasStartedWriting) {
          fail(
            new PrinterError(
              'NETWORK_PRINTER_UNREACHABLE',
              `Không thể kết nối tới máy in LAN (${host}:${port}): ${err.message}`,
              { cause: err, failureStage: 'BEFORE_WRITE' },
            ),
          );
        } else {
          fail(
            new PrinterError(
              'SOCKET_WRITE_ERROR',
              `Lỗi truyền dữ liệu tới máy in (${host}:${port}): ${err.message}`,
              { cause: err, failureStage: 'DURING_WRITE' },
            ),
          );
        }
      });

      socket.connect(port, host, () => {
        // Connected! Adjust timeout for data transmission
        socket.setTimeout(this.writeTimeoutMs);
        hasStartedWriting = true;

        const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        socket.write(buffer, (err) => {
          if (err) {
            fail(
              new PrinterError(
                'SOCKET_WRITE_ERROR',
                `Lỗi khi ghi dữ liệu tới máy in: ${err.message}`,
                { cause: err, failureStage: 'DURING_WRITE' },
              ),
            );
            return;
          }
          // Gracefully flush and close socket
          socket.end(() => {
            succeed();
          });
        });
      });
    });
  }
}
