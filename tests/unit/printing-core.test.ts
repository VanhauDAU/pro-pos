import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getReceiptPrintProfile } from '../../src/contracts/store';
import { buildEscPosRasterReceipt } from '../../src/printing/escpos/escpos-builder';
import { imageDataToEscPosRaster } from '../../src/printing/escpos/escpos-raster';
import { buildEscPosTextReceipt } from '../../src/printing/escpos/escpos-text-builder';
import { PrinterService, validatePrinterConfig } from '../../src/printing/printer-service';
import type { PrintTransport } from '../../src/printing/transports/print-transport';
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
  const mockTransport: PrintTransport = {
    print: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
    await new PrinterService(renderer, mockTransport).testPrint(networkConfig, 'PRO POS BILLIARDS');
    expect(receivedHtml).toContain('HÓA ĐƠN');
    expect(receivedHtml).toContain('Thu ngân: Văn Hậu');
    expect(receivedHtml).toContain('Khách: Nguyễn Ánh');
    expect(receivedHtml).toContain('Cảm ơn quý khách');
    expect(mockTransport.print).toHaveBeenCalledOnce();
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

  it('generates text ESC/POS receipt with proper commands and line structure', () => {
    const textReceipt = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'HD-001',
        invoiceCode: 'HD-001',
        orderType: 'DINE_IN',
        total: 120000,
        subtotal: 120000,
        discountTotal: 0,
        issuedAtMs: Date.now(),
        tableName: 'Bàn 01',
        cashierName: 'Thu ngân 1',
        lines: [
          {
            id: '1',
            name: 'Cà phê đá',
            quantity: 2,
            unitPrice: 30000,
            totalPrice: 60000,
          },
        ],
      },
      {
        paperSize: 'K80',
        storeName: 'PRO POS COFFEE',
        autoCut: true,
      },
    );
    expect(textReceipt.length).toBeGreaterThan(50);
    // Initializes with ESC @
    expect(textReceipt[0]).toBe(0x1b);
    expect(textReceipt[1]).toBe(0x40);
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
