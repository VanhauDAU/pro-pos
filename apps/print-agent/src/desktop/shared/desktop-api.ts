import type { AgentRuntimeState, PrinterTestResult } from '../../core/agent-runtime';

export interface DesktopAgentConfig {
  serverUrl: string;
  storeId: string | null;
  storeName: string | null;
  agentId: string | null;
  connectionType: 'NETWORK_TCP' | 'WINDOWS_PRINTER';
  printerName: string;
  printerIp: string;
  printerPort: number;
  paperSize: 'K80' | 'K58';
  autoCut?: boolean | undefined;
  openCashDrawer?: boolean | undefined;
  printableDots?: number | undefined;
}

export interface DesktopAgentInfo {
  version: string;
  autostart: boolean;
  config: DesktopAgentConfig;
}

export interface DesktopSettingsInput {
  serverUrl: string;
  connectionType: 'NETWORK_TCP' | 'WINDOWS_PRINTER';
  printerName?: string | undefined;
  printerIp?: string | undefined;
  printerPort?: number | undefined;
  paperSize: 'K80' | 'K58';
  autoCut?: boolean | undefined;
  openCashDrawer?: boolean | undefined;
  printableDots?: number | undefined;
}

export interface DesktopPrinterItem {
  name: string;
  displayName: string;
  isDefault: boolean;
  status?: number | string;
}

export type DesktopPrintJobStatus = 'SENDING' | 'COMPLETED' | 'FAILED';

export interface DesktopPrintJobState {
  jobId: string;
  documentType: string | null;
  status: DesktopPrintJobStatus;
  updatedAt: number;
  failureCode?: string;
}

export interface ProPosPrintAgentApi {
  getState(): Promise<AgentRuntimeState>;
  getInfo(): Promise<DesktopAgentInfo>;
  getLastJob(): Promise<DesktopPrintJobState | null>;
  testPrinter(settings?: DesktopSettingsInput): Promise<PrinterTestResult>;
  listPrinters(): Promise<DesktopPrinterItem[]>;
  reconnect(): Promise<void>;
  startPairing(): Promise<void>;
  cancelPairing(): Promise<void>;
  setAutostart(enabled: boolean): Promise<boolean>;
  saveSettings(settings: DesktopSettingsInput): Promise<void>;
  openLogs(): Promise<string>;
  resetPairing(): Promise<void>;
  resetAll(): Promise<void>;
  showWindow(): Promise<void>;
  onStateChanged(listener: (state: AgentRuntimeState) => void): () => void;
  onJobChanged(listener: (job: DesktopPrintJobState) => void): () => void;
}

declare global {
  interface Window {
    proposPrintAgent: ProPosPrintAgentApi;
  }
}
