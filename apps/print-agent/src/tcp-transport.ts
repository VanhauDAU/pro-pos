import * as net from 'node:net';

export interface TcpPrintOptions {
  host: string;
  port?: number;
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export class AgentTcpTransport {
  private readonly connectTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(options?: { connectTimeoutMs?: number; writeTimeoutMs?: number }) {
    this.connectTimeoutMs = options?.connectTimeoutMs ?? 5000;
    this.writeTimeoutMs = options?.writeTimeoutMs ?? 10000;
  }

  async send(data: Uint8Array, options: TcpPrintOptions): Promise<void> {
    const host = options.host.trim();
    const port = options.port ?? 9100;

    if (!host) {
      throw new Error('Địa chỉ IP máy in không hợp lệ.');
    }

    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let hasWritten = false;
      let settled = false;

      const cleanup = () => {
        socket.removeAllListeners();
        if (!socket.destroyed) {
          socket.destroy();
        }
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      socket.setTimeout(this.connectTimeoutMs);

      socket.on('timeout', () => {
        if (!hasWritten) {
          fail(
            new Error(
              `Timeout kết nối tới máy in LAN (${host}:${port}) sau ${this.connectTimeoutMs}ms`,
            ),
          );
        } else {
          fail(
            new Error(
              `Timeout truyền dữ liệu tới máy in LAN (${host}:${port}) sau ${this.writeTimeoutMs}ms`,
            ),
          );
        }
      });

      socket.on('error', (err) => {
        fail(new Error(`Lỗi kết nối máy in (${host}:${port}): ${err.message}`));
      });

      socket.connect(port, host, () => {
        socket.setTimeout(this.writeTimeoutMs);
        hasWritten = true;

        const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        socket.write(buffer, (err) => {
          if (err) {
            fail(new Error(`Lỗi khi gửi dữ liệu in: ${err.message}`));
            return;
          }
          socket.end(() => {
            succeed();
          });
        });
      });
    });
  }
}
