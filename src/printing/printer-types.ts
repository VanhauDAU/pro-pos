import type { PaperSize } from '@contracts/store';

export type PrinterConnectionType = 'SYSTEM' | 'NETWORK_TCP';

export interface PrinterConfig {
  connectionType: PrinterConnectionType;
  printerName?: string | undefined;
  networkIp?: string | undefined;
  networkPort?: number | undefined;
  paperSize: PaperSize;
  printableDots?: number | undefined;
  autoCut: boolean;
  openCashDrawer: boolean;
}

export interface PrinterConnectionStatus {
  connected: boolean;
  version?: string | undefined;
  error?: string | undefined;
}

export interface ReceiptPrintJob {
  config: PrinterConfig;
  htmlCopies: string[];
  openCashDrawer?: boolean | undefined;
  jobName?: string | undefined;
}

export interface PrinterActionResult {
  success: boolean;
  message?: string;
  code?: string;
}
