import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface PrintAgentConfig {
  serverUrl: string;
  storeId?: string | undefined;
  storeName?: string | undefined;
  agentId?: string | undefined;
  agentSecret?: string | undefined;
  printerIp?: string | undefined;
  printerPort?: number | undefined;
  paperSize?: 'K80' | 'K58' | undefined;
  printableDots?: number | undefined;
  autoCut?: boolean | undefined;
  openCashDrawer?: boolean | undefined;
}

const DEFAULT_SERVER_URL = process.env.PROPOS_SERVER_URL || 'http://localhost:5173';

export class ConfigManager {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor() {
    this.configDir = path.join(os.homedir(), '.propos-print-agent');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  loadConfig(): PrintAgentConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          serverUrl: parsed.serverUrl || DEFAULT_SERVER_URL,
          ...parsed,
        };
      }
    } catch {
      // Fallback
    }

    return {
      serverUrl: process.env.PROPOS_SERVER_URL || DEFAULT_SERVER_URL,
      printerIp: process.env.PRINTER_IP || '192.168.1.73',
      printerPort: Number(process.env.PRINTER_PORT) || 9100,
      paperSize: 'K80',
      printableDots: 576,
      autoCut: true,
      openCashDrawer: false,
    };
  }

  saveConfig(config: PrintAgentConfig): void {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('[Config] Failed to save config to disk:', err);
    }
  }

  isPaired(config: PrintAgentConfig): boolean {
    return Boolean(config.agentId && config.agentSecret && config.storeId);
  }
}
