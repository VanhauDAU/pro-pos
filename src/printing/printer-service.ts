import { getReceiptPrintProfile } from '@contracts/store';

import { buildEscPosRasterReceipt, combineEscPosReceipts } from './escpos/escpos-builder';
import { asPrinterError, PrinterError } from './printer-errors';
import type { PrinterActionResult, PrinterConfig, ReceiptPrintJob } from './printer-types';
import { browserReceiptRenderer } from './receipt/receipt-renderer';
import { createCalibrationReceiptHtml, createTestReceiptHtml } from './receipt/receipt-template';
import type { ReceiptRenderer } from './receipt/receipt-types';
import type { PrintTransport } from './transports/print-transport';
import { TcpEscPosTransport } from './transports/tcp-transport';

export function validatePrinterConfig(config: PrinterConfig) {
  if (!config || !['SYSTEM', 'NETWORK_TCP'].includes(config.connectionType)) {
    throw new PrinterError('INVALID_PRINTER_CONFIG');
  }
  if (config.connectionType === 'SYSTEM' && !config.printerName?.trim()) {
    throw new PrinterError('INVALID_PRINTER_CONFIG', 'Vui lòng chọn máy in hệ thống.');
  }
  if (config.connectionType === 'NETWORK_TCP') {
    const host = config.networkIp?.trim();
    const port = config.networkPort ?? 9100;
    const isIpv4 =
      Boolean(host) &&
      host!.split('.').length === 4 &&
      host!.split('.').every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
    if (!isIpv4 || port < 1 || port > 65_535) {
      throw new PrinterError(
        'INVALID_PRINTER_CONFIG',
        'Địa chỉ IP hoặc cổng máy in LAN không hợp lệ.',
      );
    }
  }
  const profile = getReceiptPrintProfile(config.paperSize, config.printableDots);
  if (profile.defaultPrintableDots < 200 || profile.defaultPrintableDots > 1200) {
    throw new PrinterError('INVALID_PRINTER_CONFIG', 'Vùng in phải từ 200 đến 1200 dots.');
  }
  return profile;
}

export class PrinterService {
  constructor(
    private readonly renderer: ReceiptRenderer = browserReceiptRenderer,
    private readonly transport: PrintTransport = new TcpEscPosTransport(),
  ) {}

  async printReceipt(job: ReceiptPrintJob): Promise<void> {
    const profile = validatePrinterConfig(job.config);
    if (job.htmlCopies.length === 0) throw new PrinterError('RENDER_FAILED');

    const images = await this.renderer.renderCopies(
      job.htmlCopies.map((html) => ({ html, profile })),
    );
    const receipts = images.map((image, index) =>
      buildEscPosRasterReceipt(image, {
        printableDots: profile.defaultPrintableDots,
        autoCut: job.config.autoCut,
        openCashDrawer: Boolean(job.openCashDrawer) && index === images.length - 1,
      }),
    );
    const payload = combineEscPosReceipts(receipts);
    await this.transport.print(payload, job.config);
  }

  async testPrint(config: PrinterConfig, storeName?: string): Promise<void> {
    await this.printReceipt({
      config,
      htmlCopies: [createTestReceiptHtml(storeName)],
      openCashDrawer: config.openCashDrawer,
      jobName: 'Pro POS Test Receipt',
    });
  }

  async calibrationPrint(config: PrinterConfig): Promise<void> {
    const profile = validatePrinterConfig(config);
    await this.printReceipt({
      config: { ...config, openCashDrawer: false },
      htmlCopies: [createCalibrationReceiptHtml(profile.defaultPrintableDots)],
      openCashDrawer: false,
      jobName: 'Pro POS Printer Calibration',
    });
  }
}

export const printerService = new PrinterService();

export async function printerAction(action: () => Promise<void>): Promise<PrinterActionResult> {
  try {
    await action();
    return { success: true };
  } catch (error) {
    const printerError = asPrinterError(error);
    if ((import.meta as any).env?.DEV) console.error('[printing]', printerError.code, error);
    return { success: false, code: printerError.code, message: printerError.message };
  }
}
