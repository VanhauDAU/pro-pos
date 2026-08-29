import { AgentApiClient } from './api-client';
import { ConfigManager } from './config';
import { PairingHandler } from './pairing';
import { AgentRealtimeClient } from './realtime-client';
import { AgentTcpTransport } from './tcp-transport';
import { buildEscPosTextReceipt } from '@printing/escpos/escpos-text-builder';

async function main() {
  const configManager = new ConfigManager();
  let config = configManager.loadConfig();

  // Parse CLI args
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--server' && args[i + 1]) {
      config.serverUrl = args[++i]!;
    } else if (arg === '--ip' && args[i + 1]) {
      config.printerIp = args[++i]!;
    } else if (arg === '--port' && args[i + 1]) {
      config.printerPort = Number(args[++i]);
    } else if (arg === '--reset') {
      config.agentId = undefined;
      config.agentSecret = undefined;
      config.storeId = undefined;
      configManager.saveConfig(config);
      console.log('Đã reset cấu hình Print Agent.');
    }
  }

  // 1. Check if device is paired
  if (!configManager.isPaired(config)) {
    const pairing = new PairingHandler(configManager, config);
    config = await pairing.startPairingFlow();
  }

  // 2. Display Status Banner
  console.log('\n========================================');
  console.log('    PRO POS PRINT AGENT (v0.1.0)');
  console.log('========================================');
  console.log('● Trạng thái : \x1b[32mĐANG HOẠT ĐỘNG (ONLINE)\x1b[0m');
  console.log(`Cửa hàng     : ${config.storeName || config.storeId}`);
  console.log(
    `Máy in LAN   : \x1b[1m${config.printerIp || '192.168.1.73'}:${config.printerPort || 9100}\x1b[0m (${config.paperSize || 'K80'})`,
  );
  console.log(`Máy chủ      : ${config.serverUrl}`);
  console.log('----------------------------------------');
  console.log('Tự động in tất cả yêu cầu in từ Điện thoại / iPad / Web POS.');
  console.log('Không mở popup, không cần xác nhận trên máy tính.');
  console.log('========================================\n');

  // 3. Test print on start if requested
  if (args.includes('--test')) {
    console.log('[Test] Đang thực hiện in thử máy in LAN...');
    const transport = new AgentTcpTransport();
    const testReceipt = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'TEST-001',
        invoiceCode: 'TEST-001',
        orderType: 'DINE_IN',
        total: 50000,
        subtotal: 50000,
        discountTotal: 0,
        issuedAtMs: Date.now(),
        tableName: 'Bàn Test',
        cashierName: 'Print Agent Test',
        lines: [
          {
            id: '1',
            name: 'In thử Pro POS Print Agent',
            quantity: 1,
            unitPrice: 50000,
            totalPrice: 50000,
          },
        ],
      },
      {
        paperSize: config.paperSize || 'K80',
        storeName: 'PRO POS PRINT AGENT TEST',
        autoCut: true,
      },
    );
    try {
      await transport.send(testReceipt, {
        host: config.printerIp || '192.168.1.73',
        port: config.printerPort || 9100,
      });
      console.log('\x1b[32m✔ In thử thành công!\x1b[0m');
    } catch (err: any) {
      console.error('\x1b[31m✘ In thử thất bại:\x1b[0m', err.message);
    }
  }

  // 4. Start Realtime Outbound Client
  const apiClient = new AgentApiClient(config);
  const realtimeClient = new AgentRealtimeClient(config, apiClient);
  realtimeClient.connect();

  // Handle graceful exit
  process.on('SIGINT', () => {
    console.log('\nĐang dừng Pro POS Print Agent...');
    realtimeClient.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    realtimeClient.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('\x1b[31mLỗi khởi động Print Agent:\x1b[0m', err);
  process.exit(1);
});
