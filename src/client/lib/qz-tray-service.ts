import qz from 'qz-tray';

// Disable default certificate signing requirements for local/direct websocket usage
try {
  qz.security.setCertificatePromise((resolve: (cert?: string) => void) => {
    resolve();
  });
  qz.security.setSignaturePromise(() => (resolve: (sig?: string) => void) => {
    resolve();
  });
} catch {
  // Ignore if already set
}

export function getClientDeviceName(): string {
  if (typeof window === 'undefined') return 'Thiết bị POS';
  const userAgent = navigator.userAgent || '';
  const navAny = navigator as unknown as { userAgentData?: { platform?: string } };
  const platform = navAny.userAgentData?.platform || navigator.platform || '';

  if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) {
    return 'MacBook / macOS';
  }
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) {
    return 'Windows-PC';
  }
  if (/Linux/i.test(platform)) {
    return 'Linux POS';
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return 'iPad / iOS';
  }
  if (/Android/i.test(userAgent)) {
    return 'Android POS';
  }
  return 'Thiết bị POS';
}

export async function checkQzTrayStatus(): Promise<{
  connected: boolean;
  version?: string | undefined;
  error?: string | undefined;
}> {
  try {
    if (qz.websocket.isActive()) {
      const version = await qz.api.getVersion();
      return { connected: true, version };
    }
    return { connected: false };
  } catch (err: unknown) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function connectQzTray(): Promise<{
  connected: boolean;
  version?: string | undefined;
  error?: string | undefined;
}> {
  try {
    if (qz.websocket.isActive()) {
      const version = await qz.api.getVersion();
      return { connected: true, version };
    }
    await qz.websocket.connect({ retries: 2, delay: 1 });
    const version = await qz.api.getVersion();
    return { connected: true, version };
  } catch (err: unknown) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function disconnectQzTray(): Promise<void> {
  try {
    if (qz.websocket.isActive()) {
      await qz.websocket.disconnect();
    }
  } catch {
    // ignore
  }
}

export async function fetchQzPrinters(): Promise<string[]> {
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 1, delay: 0.5 });
    }
    const printers = await qz.printers.find();
    if (Array.isArray(printers)) {
      return printers;
    }
    if (typeof printers === 'string') {
      return [printers];
    }
    return [];
  } catch (err: unknown) {
    throw new Error(
      err instanceof Error ? err.message : 'Không thể lấy danh sách máy in từ QZ Tray.',
      { cause: err },
    );
  }
}

import { type PaperSize, getReceiptPrintProfile } from '@contracts/store';

export interface TestPrintOptions {
  connectionType: 'SYSTEM' | 'NETWORK_TCP';
  printerName?: string | undefined;
  networkIp?: string | undefined;
  networkPort?: number | undefined;
  paperSize: PaperSize;
  printableDots?: number | undefined;
  autoCut: boolean;
  openCashDrawer: boolean;
  storeName?: string | undefined;
}

export interface ReceiptPrintJobOptions extends TestPrintOptions {
  escPosData: string[];
  htmlData: string[];
  paperWidthMm: number;
}

export async function printEscPosReceipt(
  options: ReceiptPrintJobOptions,
): Promise<{ success: boolean; message?: string }> {
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 2, delay: 1 });
    }

    if (options.connectionType === 'NETWORK_TCP' && !options.networkIp?.trim()) {
      return { success: false, message: 'Vui lòng nhập địa chỉ IP máy in mạng.' };
    }
    if (options.connectionType === 'SYSTEM' && !options.printerName?.trim()) {
      return { success: false, message: 'Vui lòng chọn máy in hệ thống.' };
    }

    if (options.connectionType === 'SYSTEM') {
      const config = qz.configs.create(options.printerName!.trim(), {
        copies: 1,
        colorType: 'grayscale',
        interpolation: 'nearest-neighbor',
        jobName: 'Pro POS Receipt',
        margins: 0,
        rasterize: true,
        scaleContent: false,
        units: 'mm',
      });
      await qz.print(
        config,
        options.htmlData.map((data) => ({
          type: 'pixel' as const,
          format: 'html' as const,
          flavor: 'plain' as const,
          data,
          options: { pageWidth: options.paperWidthMm / 25.4 },
        })),
      );
    } else {
      const config = qz.configs.create(
        {
          host: options.networkIp!.trim(),
          port: String(options.networkPort || 9100),
        },
        { copies: 1, jobName: 'Pro POS Receipt' },
      );
      await qz.print(
        config,
        options.escPosData.map((data) => ({
          type: 'raw' as const,
          format: 'command' as const,
          flavor: 'plain' as const,
          data,
        })),
      );
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function printTestReceipt(
  options: TestPrintOptions,
): Promise<{ success: boolean; message?: string }> {
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 2, delay: 1 });
    }

    let config;
    if (options.connectionType === 'NETWORK_TCP') {
      if (!options.networkIp?.trim()) {
        return { success: false, message: 'Vui lòng nhập địa chỉ IP máy in mạng.' };
      }
      config = qz.configs.create({
        host: options.networkIp.trim(),
        port: String(options.networkPort || 9100),
      });
    } else {
      if (!options.printerName?.trim()) {
        return { success: false, message: 'Vui lòng chọn máy in hệ thống.' };
      }
      config = qz.configs.create(options.printerName.trim());
    }

    const profile = getReceiptPrintProfile(options.paperSize, options.printableDots);
    const chars = profile.charsPerLineFontA;
    const divider = '-'.repeat(chars);

    const escInit = '\x1B\x40';
    const escCenter = '\x1B\x61\x01';
    const escLeft = '\x1B\x61\x00';
    const escBoldOn = '\x1B\x45\x01';
    const escBoldOff = '\x1B\x45\x00';
    const escCut = '\x1D\x56\x41\x00';
    const escDrawer = '\x1B\x70\x00\x19\xFA';

    const storeTitle = options.storeName || 'PRO POS';
    const timestamp = new Date().toLocaleString('vi-VN');

    // Profile aware items table formatting
    let itemsBlock = '';
    if (profile.layoutMode === 'MULTI_COLUMN') {
      // K80 48-char layout: Item (22) + ' ' + Qty (4) + ' ' + UnitPrice (9) + ' ' + Total (10) = 47
      itemsBlock += 'Mat hang                SL    Don gia     T.Tien\n';
      itemsBlock += divider + '\n';
      itemsBlock += '1. Tra sua o long (L)    1     65,000     65,000\n';
      itemsBlock += '2. Com ga chua ngot      1     60,000     60,000\n';
      itemsBlock += '3. Billiard (1h30p)      1     50,000     50,000\n';
    } else {
      // K58 35-char layout: Item (18) + ' ' + Qty (4) + ' ' + Total (11) = 34
      itemsBlock += 'Mat hang           SL       T.Tien\n';
      itemsBlock += divider + '\n';
      itemsBlock += '1. Tra sua o long   1       65,000\n';
      itemsBlock += '   * D.Gia: 65,000\n';
      itemsBlock += '2. Com ga chua ngot 1       60,000\n';
      itemsBlock += '3. Billiard (1h30p) 1       50,000\n';
    }

    let printData =
      escInit +
      escCenter +
      escBoldOn +
      storeTitle +
      '\n' +
      'HOA DON IN THU (TEST RECEIPT)\n' +
      escBoldOff +
      escLeft +
      divider +
      '\n' +
      `Thoi gian : ${timestamp}\n` +
      `Profile   : ${profile.paperSize} (${profile.paperWidthMm}mm / ${profile.printableWidthMm}mm)\n` +
      `Vung in   : ${profile.defaultPrintableDots} dots (${chars} ky tu/dong)\n` +
      `Che do    : ${options.connectionType === 'NETWORK_TCP' ? `LAN/TCP (${options.networkIp}:${options.networkPort || 9100})` : `System (${options.printerName})`}\n` +
      divider +
      '\n' +
      itemsBlock +
      divider +
      '\n' +
      escBoldOn +
      (profile.layoutMode === 'MULTI_COLUMN'
        ? 'TONG CONG:                              175,000d\n'
        : 'TONG CONG:                      175,000d\n') +
      escBoldOff +
      divider +
      '\n' +
      escCenter +
      'Cam on quy khach & Hen gap lai!\n\n\n\n';

    if (options.openCashDrawer) {
      printData += escDrawer;
    }
    if (options.autoCut) {
      printData += escCut;
    }

    await qz.print(config, [
      {
        type: 'raw',
        format: 'command',
        flavor: 'plain',
        data: printData,
      },
    ]);

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function printCalibrationTest(
  options: TestPrintOptions,
): Promise<{ success: boolean; message?: string }> {
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 2, delay: 1 });
    }

    let config;
    if (options.connectionType === 'NETWORK_TCP') {
      if (!options.networkIp?.trim()) {
        return { success: false, message: 'Vui lòng nhập địa chỉ IP máy in mạng.' };
      }
      config = qz.configs.create({
        host: options.networkIp.trim(),
        port: String(options.networkPort || 9100),
      });
    } else {
      if (!options.printerName?.trim()) {
        return { success: false, message: 'Vui lòng chọn máy in hệ thống.' };
      }
      config = qz.configs.create(options.printerName.trim());
    }

    const profile = getReceiptPrintProfile(options.paperSize, options.printableDots);
    const chars = profile.charsPerLineFontA;

    const escInit = '\x1B\x40';
    const escCenter = '\x1B\x61\x01';
    const escLeft = '\x1B\x61\x00';
    const escBoldOn = '\x1B\x45\x01';
    const escBoldOff = '\x1B\x45\x00';
    const escFontB = '\x1B\x4D\x01';
    const escFontA = '\x1B\x4D\x00';
    const escCut = '\x1D\x56\x41\x00';

    // Alignment marker lines:
    // Left marker [| and Right marker |] spanning exact width
    const rulerNumbers =
      profile.paperSize === 'K80'
        ? '|....5...10...15...20...25...30...35...40...45..|'
        : '|....5...10...15...20...25...30..|';

    const boxLine = '+' + '-'.repeat(chars - 2) + '+';
    const solidLine = '='.repeat(chars);

    let printData =
      escInit +
      escCenter +
      escBoldOn +
      '=== CALIBRATION / CAN CHINH VUNG IN ===\n' +
      `KHO GIAY: ${profile.paperSize} (${profile.paperWidthMm}mm)\n` +
      escBoldOff +
      escLeft +
      solidLine +
      '\n' +
      `Vung in quy chuan : ${profile.printableWidthMm}mm\n` +
      `So dot thuc te   : ${profile.defaultPrintableDots} dots\n` +
      `Font A max chars  : ${chars} ky tu/dong\n` +
      `Font B max chars  : ${profile.charsPerLineFontB} ky tu/dong\n` +
      solidLine +
      '\n' +
      '1. KIEM TRA MEP TRAI & MEP PHAI:\n' +
      rulerNumbers +
      '\n' +
      boxLine +
      '\n' +
      '|<- MEP TRAI' +
      ' '.repeat(Math.max(0, chars - 24)) +
      'MEP PHAI ->|\n' +
      boxLine +
      '\n\n' +
      '2. KIEM TRA DO NET FONT CHU:\n' +
      'Font A (Standard): ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789\n' +
      escFontB +
      'Font B (Condensed): ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789\n' +
      escFontA +
      '\n' +
      '3. KIEM TRA MAT HANG / COT:\n' +
      (profile.layoutMode === 'MULTI_COLUMN'
        ? '[Cot 1: 22 chars]    [SL] [Don gia] [T.Tien]\n'
        : '[Cot 1: 18 chars]    [SL] [Thanh tien]\n') +
      solidLine +
      '\n' +
      escCenter +
      'KET QUA: Vung in va le in can doi!\n\n\n\n';

    if (options.autoCut) {
      printData += escCut;
    }

    await qz.print(config, [
      {
        type: 'raw',
        format: 'command',
        flavor: 'plain',
        data: printData,
      },
    ]);

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
