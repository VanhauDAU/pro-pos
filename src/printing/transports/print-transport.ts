import type { PrinterConfig } from '../printer-types';

export interface PrintTransport {
  print(data: Uint8Array, config: PrinterConfig): Promise<void>;
}
