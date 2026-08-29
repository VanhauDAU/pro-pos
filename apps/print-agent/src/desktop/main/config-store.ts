import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { PrintAgentConfig } from '../../config';
import { CredentialStore } from './credential-store';

const DEFAULT_CONFIG: PrintAgentConfig = { serverUrl: 'http://localhost:5173', paperSize: 'K80', printableDots: 576, autoCut: true, openCashDrawer: false };

/** Stores routing/settings in userData and the permanent agent secret in Windows DPAPI. */
export class DesktopConfigStore {
  private readonly configPath: string;
  private readonly credentials: CredentialStore;

  constructor(userDataPath: string) {
    this.configPath = join(userDataPath, 'config.json');
    this.credentials = new CredentialStore(join(userDataPath, 'credentials.bin'), safeStorage);
  }

  loadConfig(): PrintAgentConfig {
    try {
      const value = JSON.parse(readFileSync(this.configPath, 'utf8')) as PrintAgentConfig;
      return { ...DEFAULT_CONFIG, ...value, agentSecret: this.credentials.load() };
    } catch {
      return { ...DEFAULT_CONFIG, agentSecret: this.credentials.load() };
    }
  }

  saveConfig(config: PrintAgentConfig): void {
    const { agentSecret, ...nonSecretConfig } = config;
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(nonSecretConfig, null, 2), 'utf8');
    this.credentials.save(agentSecret);
  }

  isPaired(config: PrintAgentConfig): boolean {
    return Boolean(config.agentId && config.agentSecret && config.storeId);
  }
}
