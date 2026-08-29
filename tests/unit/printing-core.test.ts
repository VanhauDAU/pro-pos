import { beforeEach, describe, expect, it, vi } from 'vitest';

const qzMocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  isActive: vi.fn(() => true),
  find: vi.fn(async (): Promise<string[]> => ['KPOS ZY307']),
  create: vi.fn(() => ({ printer: 'mock' })),
  print: vi.fn(async (_config: unknown, _jobs: Array<Record<string, unknown>>) => undefined),
}));

vi.mock('qz-tray', () => ({
  default: {
    api: { getVersion: vi.fn(async () => '2.2.6') },
    configs: { create: qzMocks.create },
    print: qzMocks.print,
    printers: { find: qzMocks.find },
    security: {
      setCertificatePromise: vi.fn(),
      setSignatureAlgorithm: vi.fn(),
      setSignaturePromise: vi.fn(),
    },
    websocket: {
      connect: qzMocks.connect,
      disconnect: qzMocks.disconnect,
      isActive: qzMocks.isActive,
    },
  },
}));

import { getReceiptPrintProfile } from '../../src/contracts/store';
import { buildEscPosRasterReceipt } from '../../src/printing/escpos/escpos-builder';
import { imageDataToEscPosRaster } from '../../src/printing/escpos/escpos-raster';
import { PrinterService, validatePrinterConfig } from '../../src/printing/printer-service';
import { ensureQzConnected, resetQzClientForTests } from '../../src/printing/qz/qz-client';
import { clearPrinterDiscoveryCache } from '../../src/printing/qz/qz-printer-discovery';
import { qzPrintRaw } from '../../src/printing/qz/qz-print';
import {
  createTestReceiptHtml,
  receiptRasterCss,
} from '../../src/printing/receipt/receipt-template';
import type { ReceiptRenderer } from '../../src/printing/receipt/receipt-types';
import { receiptImageCredentials } from '../../src/printing/receipt/receipt-renderer';

const networkConfig = {
  connectionType: 'NETWORK_TCP' as const,
  networkIp: '192.168.1.73',
  networkPort: 9100,
  paperSize: 'K80' as const,
  autoCut: true,
  openCashDrawer: false,
};

function solidImage(width: number, height = 1, value = 255) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(value) };
}

describe('printing core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qzMocks.isActive.mockReturnValue(true);
    qzMocks.find.mockResolvedValue(['KPOS ZY307']);
    clearPrinterDiscoveryCache();
    resetQzClientForTests();
  });

  it('keeps the 80 mm profile within the real 576-dot print head', () => {
    const profile = getReceiptPrintProfile('K80');
    expect(profile.printableWidthMm).toBe(72);
    expect(profile.defaultPrintableDots).toBeLessThanOrEqual(576);
    expect(receiptRasterCss(profile.defaultPrintableDots)).toContain('width: 576px');
  });

  it('preserves Vietnamese Unicode until the browser raster boundary', async () => {
    let receivedHtml = '';
    const renderer: ReceiptRenderer = {
      async renderCopies(requests) {
        receivedHtml = requests[0]!.html;
        return [solidImage(requests[0]!.profile.defaultPrintableDots)];
      },
    };
    await new PrinterService(renderer).testPrint(networkConfig, 'PRO POS BILLIARDS');
    expect(receivedHtml).toContain('HÓA ĐƠN');
    expect(receivedHtml).toContain('Thu ngân: Văn Hậu');
    expect(receivedHtml).toContain('Khách: Nguyễn Ánh');
    expect(receivedHtml).toContain('Cảm ơn quý khách');
  });

  it('allows long product names to wrap while keeping money right-aligned', () => {
    const css = receiptRasterCss(576);
    expect(css).toContain('font-size: 23px !important');
    expect(css).toContain('font-size: 22px !important');
    expect(css).toContain('font-size: 20px !important');
    expect(css).toContain('color: #000 !important');
    expect(css).toContain('white-space: normal');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(createTestReceiptHtml()).toContain('tên món rất dài để kiểm tra tự động xuống dòng');
  });

  it('uses a readable but compact typography scale for 58 mm receipts', () => {
    const css = receiptRasterCss(420);
    expect(css).toContain('font-size: 19px !important');
    expect(css).toContain('font-size: 17px !important');
    expect(css).toContain('font-size: 21px !important');
    expect(css).not.toContain('font-size: 23px !important');
  });

  it('keeps table headings and uses a large printable QR profile', () => {
    const css = receiptRasterCss(576);
    expect(css).toContain('thermal-receipt-table-header { display: flex !important');
    expect(css).toContain('width: 200px !important');
    expect(css).not.toContain('thermal-receipt-table-header { display: none');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 108px 124px');
    expect(css).toContain(':last-child:not(:first-child)');
    expect(css).toContain('thermal-receipt-col-unit-price');
    expect(css).toContain('thermal-receipt-col-total');
    expect(css).not.toContain('nth-last-child');
  });

  it('loads protected local images with credentials and VietQR without credentials', () => {
    expect(receiptImageCredentials('/api/v1/media/logo', 'https://pos.example')).toBe('include');
    expect(
      receiptImageCredentials(
        'https://img.vietqr.io/image/MB-000-qr_only.png',
        'https://pos.example',
      ),
    ).toBe('omit');
  });

  it('shares one in-flight QZ connection between simultaneous jobs', async () => {
    qzMocks.isActive.mockReturnValue(false);
    await Promise.all([ensureQzConnected(), ensureQzConnected(), ensureQzConnected()]);
    expect(qzMocks.connect).toHaveBeenCalledOnce();
  });

  it('fails fast when QZ is not running without spending time rasterizing', async () => {
    qzMocks.isActive.mockReturnValue(false);
    qzMocks.connect.mockRejectedValueOnce(new Error('WebSocket unavailable'));
    const renderer: ReceiptRenderer = { renderCopies: vi.fn(async () => [solidImage(576)]) };

    await expect(
      new PrinterService(renderer).printReceipt({
        config: networkConfig,
        htmlCopies: ['HÓA ĐƠN'],
      }),
    ).rejects.toMatchObject({ code: 'QZ_NOT_RUNNING' });
    expect(renderer.renderCopies).not.toHaveBeenCalled();
  });

  it('returns PRINTER_NOT_FOUND before rendering a missing system printer', async () => {
    qzMocks.find.mockResolvedValue([]);
    const renderer: ReceiptRenderer = { renderCopies: vi.fn(async () => [solidImage(576)]) };
    await expect(
      new PrinterService(renderer).printReceipt({
        config: {
          ...networkConfig,
          connectionType: 'SYSTEM',
          printerName: 'KPOS ZY307',
        },
        htmlCopies: ['HÓA ĐƠN'],
      }),
    ).rejects.toMatchObject({ code: 'PRINTER_NOT_FOUND' });
    expect(renderer.renderCopies).not.toHaveBeenCalled();
  });

  it('uses only raw base64 command data, never PostScript, PDF, pixel, or HTML', async () => {
    await qzPrintRaw(networkConfig, Uint8Array.of(0x1b, 0x40, 0x1d, 0x56, 0x00));
    const [, jobs] = qzMocks.print.mock.calls[0]!;
    expect(jobs).toEqual([
      expect.objectContaining({ type: 'raw', format: 'command', flavor: 'base64' }),
    ]);
    const serialized = JSON.stringify(jobs);
    expect(serialized).not.toContain('pixel');
    expect(serialized).not.toContain('html');
    expect(serialized).not.toContain('pdf');
    expect(serialized).not.toContain('%!PS-Adobe');
  });

  it('packs GS v 0 with the correct 576-dot byte width and row orientation', () => {
    const image = solidImage(576, 2, 255);
    image.data.set([0, 0, 0, 255], 0);
    const raster = imageDataToEscPosRaster(image, 576);
    expect(Array.from(raster.slice(0, 8))).toEqual([0x1d, 0x76, 0x30, 0, 72, 0, 2, 0]);
    expect(raster[8]).toBe(0x80);
    expect(raster[8 + 72]).toBe(0);
  });

  it('places the cutter command at the end of the receipt payload', () => {
    const payload = buildEscPosRasterReceipt(solidImage(8, 1, 0), {
      printableDots: 576,
      autoCut: true,
      openCashDrawer: false,
    });
    expect(Array.from(payload.slice(-4))).toEqual([0x1d, 0x56, 0x41, 0x00]);
  });

  it('validates system and LAN configs without hard-coding one printer profile', () => {
    expect(validatePrinterConfig(networkConfig).defaultPrintableDots).toBe(576);
    expect(
      validatePrinterConfig({
        connectionType: 'SYSTEM',
        printerName: 'KPOS ZY307',
        paperSize: 'K58',
        printableDots: 384,
        autoCut: true,
        openCashDrawer: false,
      }).defaultPrintableDots,
    ).toBe(384);
    expect(() => validatePrinterConfig({ ...networkConfig, networkIp: 'not-an-ip' })).toThrow(
      'Địa chỉ IP',
    );
  });
});
