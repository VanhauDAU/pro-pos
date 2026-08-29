import { ConfigManager } from './config';
import { AgentRuntime } from './core/agent-runtime';

async function main() {
  const configManager = new ConfigManager();
  let config = configManager.loadConfig();
  const initialServerUrl = config.serverUrl;
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--server' && args[index + 1]) config.serverUrl = args[++index]!;
    else if (argument === '--ip' && args[index + 1]) config.printerIp = args[++index]!;
    else if (argument === '--port' && args[index + 1]) config.printerPort = Number(args[++index]);
    else if (argument === '--reset') {
      config.agentId = undefined;
      config.agentSecret = undefined;
      config.storeId = undefined;
      config.storeName = undefined;
      configManager.saveConfig(config);
      console.log('Đã reset cấu hình Print Agent.');
    }
  }

  if (initialServerUrl && config.serverUrl && initialServerUrl !== config.serverUrl && configManager.isPaired(config)) {
    console.log(`\x1b[33m[Config] Phát hiện máy chủ thay đổi: ${initialServerUrl} ➔ ${config.serverUrl}\x1b[0m`);
    console.log('Xóa khóa ghép nối cũ để ghép nối với máy chủ mới...\n');
    config.agentId = undefined;
    config.agentSecret = undefined;
    config.storeId = undefined;
    config.storeName = undefined;
    configManager.saveConfig(config);
  }

  const runtime = new AgentRuntime(config);
  runtime.on('stateChanged', (state) => {
    if (state.status === 'ONLINE') console.log('\x1b[32m● Trạng thái: ĐANG HOẠT ĐỘNG (ONLINE)\x1b[0m');
    if (state.status === 'OFFLINE' || state.status === 'DEGRADED') {
      console.warn(`[Runtime] ${state.status}: ${state.lastError || 'đang khôi phục kết nối'}`);
    }
  });
  runtime.on('pairingChanged', (pairing) => {
    if (pairing.code) console.log(`[Runtime] Mã ghép nối đã sẵn sàng (hết hạn: ${new Date(pairing.expiresAt!).toLocaleTimeString()}).`);
  });

  await runtime.start();
  if (runtime.getState().status === 'UNPAIRED') await runtime.startPairing();

  const currentConfig = runtime.getConfig();
  console.log('\n========================================');
  console.log('    PRO POS PRINT AGENT (v0.1.0)');
  console.log('========================================');
  console.log(`Cửa hàng     : ${currentConfig?.storeName || currentConfig?.storeId || 'Đang ghép nối'}`);
  console.log(`Máy in LAN   : \x1b[1m${currentConfig?.printerIp || '192.168.1.73'}:${currentConfig?.printerPort || 9100}\x1b[0m (${currentConfig?.paperSize || 'K80'})`);
  console.log(`Máy chủ      : ${currentConfig?.serverUrl || config.serverUrl}`);
  console.log('Tự động in tất cả yêu cầu in từ Điện thoại / iPad / Web POS.\n');

  if (args.includes('--test')) {
    console.log('[Test] Đang thực hiện in thử máy in LAN...');
    const result = await runtime.testPrinter();
    if (result.ok) console.log('\x1b[32m✔ Đã gửi lệnh in thử tới máy in.\x1b[0m');
    else console.error(`\x1b[31m✘ In thử thất bại: ${result.error}\x1b[0m`);
  }

  const shutdown = () => {
    console.log('\nĐang dừng Pro POS Print Agent...');
    void runtime.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('\x1b[31mLỗi khởi động Print Agent:\x1b[0m', error);
  process.exit(1);
});
