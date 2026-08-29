import type { PaperSize } from '@contracts/store';
import { printerAction, printerService } from '@printing/printer-service';
import type { PrinterConfig } from '@printing/printer-types';
import { disconnectQz } from '@printing/qz/qz-client';

export function getClientDeviceName(): string {
  if (typeof window === 'undefined') return 'Thiết bị POS';
  const userAgent = navigator.userAgent || '';
  const navAny = navigator as unknown as { userAgentData?: { platform?: string } };
  const platform = navAny.userAgentData?.platform || navigator.platform || '';
  if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) return 'MacBook / macOS';
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'Windows-PC';
  if (/Linux/i.test(platform)) return 'Linux POS';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iPad / iOS';
  if (/Android/i.test(userAgent)) return 'Android POS';
  return 'Thiết bị POS';
}

export function checkQzTrayStatus() {
  return printerService.checkConnection(false);
}

export function connectQzTray() {
  return printerService.checkConnection(true);
}

export function disconnectQzTray() {
  return disconnectQz();
}

export function fetchQzPrinters(forceRefresh = false) {
  return printerService.listPrinters(forceRefresh);
}

export interface TestPrintOptions extends PrinterConfig {
  storeName?: string | undefined;
}

export interface ReceiptPrintJobOptions extends TestPrintOptions {
  htmlData: string[];
  imageData?: string[] | undefined;
  paperWidthMm: number;
}

export function printEscPosReceipt(options: ReceiptPrintJobOptions) {
  return printerAction(() =>
    printerService.printReceipt({
      config: options,
      htmlCopies: options.htmlData,
      openCashDrawer: options.openCashDrawer,
    }),
  );
}

export function printTestReceipt(options: TestPrintOptions) {
  return printerAction(() => printerService.testPrint(options, options.storeName));
}

export function printCalibrationTest(options: TestPrintOptions) {
  return printerAction(() => printerService.calibrationPrint(options));
}

export type { PaperSize };
