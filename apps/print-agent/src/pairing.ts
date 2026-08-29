import { AgentApiClient } from './api-client';
import { ConfigManager, type PrintAgentConfig } from './config';

export interface PairingResult {
  agentId: string;
  agentSecret: string;
  storeId: string;
  storeName?: string;
}

export class PairingHandler {
  constructor(
    private readonly configManager: ConfigManager,
    private config: PrintAgentConfig,
  ) {}

  async startPairingFlow(options?: {
    signal?: AbortSignal;
    onCodeReady?: (code: string, expiresAt: number) => void;
  }): Promise<PrintAgentConfig> {
    const client = new AgentApiClient(this.config);

    console.log('\n========================================');
    console.log('   PRO POS PRINT AGENT - GHÉP NỐI THIẾT BỊ');
    console.log('========================================\n');
    console.log(`Đang yêu cầu mã ghép nối từ máy chủ (${this.config.serverUrl})...`);

    let requestRes: { sessionId: string; pairingCode: string; expiresAt: number };
    try {
      requestRes = await client.post<{
        sessionId: string;
        pairingCode: string;
        expiresAt: number;
      }>('/api/v1/print-agent/pair/request', {});
    } catch (err: any) {
      console.error(
        `\n\x1b[31m✘ Không thể kết nối tới máy chủ tại: ${this.config.serverUrl}\x1b[0m`,
      );
      console.error(`Chi tiết lỗi: ${err.message}\n`);
      console.log('\x1b[33m💡 GỢI Ý KHẮC PHỤC:\x1b[0m');
      console.log('1. Nếu đang chạy cục bộ (Local):');
      console.log(
        '   - Mở 1 cửa sổ Terminal mới, tại thư mục gốc chạy: \x1b[1mpnpm dev\x1b[0m (để khởi chạy máy chủ backend)',
      );
      console.log(
        '   - Sau đó chạy lại Print Agent: \x1b[1mcd apps/print-agent && pnpm dev -- --server http://localhost:5173\x1b[0m',
      );
      console.log('2. Nếu muốn kết nối máy chủ Cloudflare / Production:');
      console.log(
        '   - Hãy deploy code mới lên server: \x1b[1mpnpm db:migrate:production && pnpm deploy:production\x1b[0m',
      );
      console.log(
        '   - Sau đó chạy: \x1b[1mpnpm dev -- --server https://<your-server-domain>\x1b[0m\n',
      );
      throw err;
    }

    const { sessionId, pairingCode, expiresAt } = requestRes;
    const formattedCode = `${pairingCode.slice(0, 3)} - ${pairingCode.slice(3)}`;

    console.log('\n----------------------------------------');
    console.log(`  MÃ GHÉP NỐI:   \x1b[1m\x1b[32m${formattedCode}\x1b[0m`);
    console.log('----------------------------------------\n');
    console.log('Hướng dẫn:');
    console.log('1. Mở Pro POS trên điện thoại hoặc máy tính.');
    console.log('2. Vào: Cài đặt → Máy in → Thêm Print Agent.');
    console.log(`3. Nhập mã số: \x1b[1m${pairingCode}\x1b[0m để hoàn tất ghép nối.\n`);
    console.log('Đang chờ xác nhận từ POS (hết hạn sau 5 phút)...');

    options?.onCodeReady?.(pairingCode, expiresAt);

    // Poll until approved or expired
    while (Date.now() < expiresAt) {
      if (options?.signal?.aborted) throw new Error('Đã hủy ghép nối.');
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Đã hủy ghép nối.'));
        };
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener('abort', onAbort);
          resolve();
        }, 2000);
        options?.signal?.addEventListener('abort', onAbort, { once: true });
      });
      if (options?.signal?.aborted) throw new Error('Đã hủy ghép nối.');

      try {
        const statusRes = await client.get<{
          status: 'PENDING' | 'APPROVED' | 'EXPIRED';
          agentId?: string;
          agentSecret?: string;
          storeId?: string;
        }>(`/api/v1/print-agent/pair/status?sessionId=${sessionId}`);

        if (
          statusRes.status === 'APPROVED' &&
          statusRes.agentId &&
          statusRes.agentSecret &&
          statusRes.storeId
        ) {
          console.log('\n\x1b[32m✔ Ghép nối thiết bị thành công!\x1b[0m');
          this.config = {
            ...this.config,
            agentId: statusRes.agentId,
            agentSecret: statusRes.agentSecret,
            storeId: statusRes.storeId,
          };
          this.configManager.saveConfig(this.config);
          return this.config;
        }

        if (statusRes.status === 'EXPIRED') {
          throw new Error(
            'Mã ghép nối đã hết hạn. Vui lòng khởi động lại Print Agent để lấy mã mới.',
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('hết hạn')) {
          throw err;
        }
        // Network blip, retry polling
      }
    }

    throw new Error('Hết thời gian chờ ghép nối. Vui lòng thử lại.');
  }
}
