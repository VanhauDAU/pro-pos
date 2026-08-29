import qz from 'qz-tray';

import { PrinterError } from '../printer-errors';
import { withQzReconnect } from './qz-client';

let cachedPrinters: string[] | null = null;

export async function listQzPrinters(forceRefresh = false): Promise<string[]> {
  if (!forceRefresh && cachedPrinters) return [...cachedPrinters];
  const result = await withQzReconnect(() => qz.printers.find());
  cachedPrinters = (Array.isArray(result) ? result : [result])
    .map((printer) => printer.trim())
    .filter(Boolean);
  return [...cachedPrinters];
}

export async function requireQzPrinter(printerName: string): Promise<void> {
  let printers = await listQzPrinters();
  if (!printers.includes(printerName)) printers = await listQzPrinters(true);
  if (!printers.includes(printerName)) {
    throw new PrinterError('PRINTER_NOT_FOUND', `Không tìm thấy máy in ${printerName}.`);
  }
}

export function clearPrinterDiscoveryCache() {
  cachedPrinters = null;
}
