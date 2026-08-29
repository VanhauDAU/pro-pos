import { ESC_POS, buildEscPosQrCode } from './escpos-commands';
import { encodeWpc1258 } from './escpos-wpc1258';
import {
  type PaperSize,
  type StorePrintSettings,
  parsePrinterDeviceConfig,
} from '@contracts/store';
import { createReceiptDocument } from '@domain/receipt/receipt-document';
import {
  type PosReceiptPrintData,
  formatDateOnly,
  formatSegmentDurationLabel,
  formatTimeOnly,
  reconcileReceiptTimeSegmentAmounts,
} from '@domain/receipt/receipt-generator';

export interface EscPosTextBuilderOptions {
  paperSize?: PaperSize | undefined;
  autoCut?: boolean | undefined;
  openCashDrawer?: boolean | undefined;
  storeName?: string | undefined;
  storeAddress?: string | undefined;
  storePhone?: string | undefined;
  printSettings?: StorePrintSettings | null | undefined;
  storeInfo?:
    | {
        storeName?: string | null | undefined;
        phone?: string | null | undefined;
        address?: string | null | undefined;
        bankName?: string | null | undefined;
        bankAccountNumber?: string | null | undefined;
        bankAccountName?: string | null | undefined;
      }
    | null
    | undefined;
  copy?: { index: number; total: number } | undefined;
  vietnameseMode?: 'WPC1258' | 'UNACCENTED' | 'UTF8' | undefined;
  bottomRasterBytes?: Uint8Array | null | undefined;
  logoRasterBytes?: Uint8Array | null | undefined;
  bottomQrContent?: string | null | undefined;
}

/**
 * Removes Vietnamese diacritics/accents and normalizes typography symbols
 * to ensure 100% compatibility with thermal printers running in standard PC437 mode.
 */
export function removeVietnameseDiacritics(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/₫/g, 'd')
    .replace(/·/g, '-')
    .replace(/[•●]/g, '*')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...');
}

/**
 * Calculates visual display width for characters (CJK/Fullwidth = 2, Latin/ASCII/Vietnamese = 1).
 */
export function visualWidth(str: string): number {
  if (!str) return 0;
  const normalized = str.normalize('NFC');
  let width = 0;
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function padEndVisual(str: string, targetWidth: number): string {
  const currentWidth = visualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

export function padStartVisual(str: string, targetWidth: number): string {
  const currentWidth = visualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return ' '.repeat(targetWidth - currentWidth) + str;
}

export function padRow(left: string, right: string, totalWidth: number): string {
  const leftWidth = visualWidth(left);
  const rightWidth = visualWidth(right);
  const space = totalWidth - leftWidth - rightWidth;
  if (space <= 0) {
    return `${left}\n${padStartVisual(right, totalWidth)}`;
  }
  return `${left}${' '.repeat(space)}${right}`;
}

/**
 * Wraps text into multiple lines such that each line's visual width <= maxWidth.
 */
export function wrapTextToWidth(text: string, maxWidth: number): string[] {
  if (!text || maxWidth <= 0) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    if (!currentLine) {
      if (visualWidth(word) <= maxWidth) {
        currentLine = word;
      } else {
        // Break very long single word into character chunks
        let remaining = word;
        while (visualWidth(remaining) > maxWidth) {
          let cutIdx = 0;
          let w = 0;
          for (let i = 0; i < remaining.length; i++) {
            const charW = visualWidth(remaining[i]!);
            if (w + charW > maxWidth) break;
            w += charW;
            cutIdx = i + 1;
          }
          if (cutIdx === 0) cutIdx = 1;
          lines.push(remaining.slice(0, cutIdx));
          remaining = remaining.slice(cutIdx);
        }
        currentLine = remaining;
      }
    } else {
      const testLine = `${currentLine} ${word}`;
      if (visualWidth(testLine) <= maxWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [''];
}

interface EscPosRasterImage {
  widthBytes: number;
  height: number;
  data: Uint8Array;
}

function parseEscPosRasterImage(bytes: Uint8Array): EscPosRasterImage | null {
  if (bytes.length < 8 || bytes[0] !== 0x1d || bytes[1] !== 0x76 || bytes[2] !== 0x30) {
    return null;
  }
  const widthBytes = bytes[4]! | (bytes[5]! << 8);
  const height = bytes[6]! | (bytes[7]! << 8);
  const dataLength = widthBytes * height;
  if (widthBytes <= 0 || height <= 0 || bytes.length < 8 + dataLength) return null;
  return { widthBytes, height, data: bytes.subarray(8, 8 + dataLength) };
}

function build24DotStripe(raster: EscPosRasterImage, sourceTop: number): Uint8Array {
  const widthDots = raster.widthBytes * 8;
  const command = new Uint8Array(5 + widthDots * 3);
  command.set([0x1b, 0x2a, 33, widthDots & 0xff, (widthDots >> 8) & 0xff]);
  for (let x = 0; x < widthDots; x += 1) {
    for (let verticalByte = 0; verticalByte < 3; verticalByte += 1) {
      let output = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const y = sourceTop + verticalByte * 8 + bit;
        if (y < 0 || y >= raster.height) continue;
        const source = raster.data[y * raster.widthBytes + (x >> 3)]!;
        if ((source & (0x80 >> (x & 7))) !== 0) output |= 0x80 >> bit;
      }
      command[5 + x * 3 + verticalByte] = output;
    }
  }
  return command;
}

function absolutePrintPosition(positionDots: number): Uint8Array {
  const safePosition = Math.max(0, Math.min(65_535, Math.round(positionDots)));
  return Uint8Array.of(0x1b, 0x24, safePosition & 0xff, (safePosition >> 8) & 0xff);
}

function buildHorizontalLogoHeader(options: {
  logoRasterBytes: Uint8Array;
  printableDots: number;
  textLines: Array<{ text: string; bold: boolean }>;
  encodeText: (text: string) => Uint8Array;
}): Uint8Array[] | null {
  const raster = parseEscPosRasterImage(options.logoRasterBytes);
  if (!raster) return null;

  const stripeHeight = 24;
  const logoWidthDots = raster.widthBytes * 8;
  const textStartDots = Math.min(options.printableDots - 1, logoWidthDots + 16);
  const rowCount = Math.max(Math.ceil(raster.height / stripeHeight), options.textLines.length);
  const logoTop = Math.floor((rowCount * stripeHeight - raster.height) / 2);
  const textTop = Math.floor((rowCount - options.textLines.length) / 2);
  const output: Uint8Array[] = [ESC_POS.alignLeft, Uint8Array.of(0x1b, 0x33, stripeHeight)];

  for (let row = 0; row < rowCount; row += 1) {
    output.push(build24DotStripe(raster, row * stripeHeight - logoTop));
    output.push(absolutePrintPosition(textStartDots));
    const line = options.textLines[row - textTop];
    if (line) {
      output.push(line.bold ? ESC_POS.boldOn : ESC_POS.boldOff);
      output.push(options.encodeText(line.text));
    }
    output.push(Uint8Array.of(0x0a));
  }
  output.push(ESC_POS.boldOff, Uint8Array.of(0x1b, 0x32));
  return output;
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDateTime(ms: number, withSeconds = false): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  const SS = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}${withSeconds ? `:${SS}` : ''}`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? `${m}p` : ''}`;
  return `${m}p`;
}

/**
 * Builds an authentic ESC/POS thermal receipt payload adhering 100% to Owner/POS template settings,
 * formatting Vietnamese cleanly without character corruption, aligning currency/columns exactly,
 * and wrapping long product names neatly without pushing numeric columns onto subsequent lines.
 */
export function buildEscPosTextReceipt(
  inputData: PosReceiptPrintData,
  options: EscPosTextBuilderOptions = {},
): Uint8Array {
  const printSettings = options.printSettings;
  const document = createReceiptDocument({
    data: inputData,
    printSettings,
    storeInfo: {
      storeName: options.storeName ?? options.storeInfo?.storeName ?? null,
      address: options.storeAddress ?? options.storeInfo?.address ?? null,
      phone: options.storePhone ?? options.storeInfo?.phone ?? null,
      bankName: options.storeInfo?.bankName ?? null,
      bankAccountNumber: options.storeInfo?.bankAccountNumber ?? null,
      bankAccountName: options.storeInfo?.bankAccountName ?? null,
    },
  });
  const { data, template } = document;

  const printerConfig = parsePrinterDeviceConfig(printSettings?.printersJson);
  const paperSize: PaperSize = options.paperSize || document.paperSize;
  const isK58 = paperSize === 'K58';
  const profile = document.profile;
  const widthChars = isK58 ? 32 : profile.charsPerLineFontA || 48;
  const divider = '-'.repeat(widthChars);

  const vietnameseMode = options.vietnameseMode ?? 'UNACCENTED';
  const isUnaccented = vietnameseMode === 'UNACCENTED';
  const currencyUnit = isUnaccented ? 'd' : 'đ';

  const sanitize = (text: string | null | undefined): string => {
    if (!text) return '';
    return isUnaccented ? removeVietnameseDiacritics(text) : text;
  };

  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const encodeText = (text: string) =>
    vietnameseMode === 'WPC1258' ? encodeWpc1258(text) : encoder.encode(text);

  const writeLine = (text = '') => {
    parts.push(encodeText(text + '\n'));
  };

  // 1. Initialize Printer
  // Do not inherit Font B/C from a previous print job.
  parts.push(ESC_POS.initialize, ESC_POS.selectFontA);
  if (vietnameseMode === 'WPC1258') {
    parts.push(Uint8Array.of(0x1b, 0x74, 52));
  }

  // 2. Header: Logo, Store Name, Address, Phone
  const storeName = sanitize(document.store.name);
  const storeAddress = sanitize(document.store.address);
  const storePhone = sanitize(document.store.phone);
  const horizontalHeaderEnabled = Boolean(
    options.logoRasterBytes && template.showLogo && printSettings?.logoHorizontalLayout,
  );
  const horizontalTextWidth = Math.max(8, Math.floor(widthChars * (isK58 ? 0.72 : 0.76)));
  const horizontalHeader =
    horizontalHeaderEnabled && options.logoRasterBytes
      ? buildHorizontalLogoHeader({
          logoRasterBytes: options.logoRasterBytes,
          printableDots: profile.defaultPrintableDots,
          textLines: [
            ...wrapTextToWidth(storeName.toUpperCase(), horizontalTextWidth).map((text) => ({
              text,
              bold: true,
            })),
            ...wrapTextToWidth(storeAddress, horizontalTextWidth).map((text) => ({
              text,
              bold: false,
            })),
            ...(storePhone ? [{ text: `SDT: ${storePhone}`, bold: false }] : []),
          ].filter((line) => line.text.length > 0),
          encodeText,
        })
      : null;

  if (horizontalHeader) {
    parts.push(...horizontalHeader);
    writeLine();
  } else {
    if (options.logoRasterBytes && template.showLogo) {
      parts.push(ESC_POS.alignCenter);
      parts.push(options.logoRasterBytes);
      writeLine();
    }

    parts.push(ESC_POS.alignCenter);
    if (storeName) {
      // Store Name: Bold & Double Size
      parts.push(ESC_POS.doubleSizeOn);
      parts.push(ESC_POS.boldOn);
      writeLine(storeName.toUpperCase());
      parts.push(ESC_POS.resetSize);
      parts.push(ESC_POS.boldOff);
    }

    if (storeAddress) writeLine(storeAddress);
    if (storePhone) writeLine(`SDT: ${storePhone}`);
    writeLine();
  }

  // 3. Receipt Title & Copy
  const rawTitle =
    data.receiptType === 'PROVISIONAL'
      ? 'HOA DON TAM TINH'
      : data.receiptType === 'DEBT_PAYMENT'
        ? 'PHIEU THU CONG NO'
        : 'HOA DON THANH TOAN';
  const title = sanitize(document.title);

  parts.push(ESC_POS.alignCenter);
  parts.push(ESC_POS.doubleHeightOn);
  parts.push(ESC_POS.boldOn);
  writeLine(title || rawTitle);
  parts.push(ESC_POS.resetSize);
  parts.push(ESC_POS.boldOff);

  const copyIndex = options.copy?.index ?? 1;
  const copyTotal =
    options.copy?.total ??
    (data.receiptType === 'PROVISIONAL'
      ? (printSettings?.provisionalCopyCount ?? 1)
      : (printSettings?.paymentCopyCount ?? 1));
  writeLine(sanitize(`Liên ${copyIndex}/${copyTotal}`));

  // Invoice Code & Issued Time (Aligned left-right)
  const rawCode = data.invoiceCode || data.orderCode || '—';
  const codeStr = sanitize(`Số: ${rawCode}`);
  const dateStr = formatDateTime(data.issuedAtMs || Date.now());

  parts.push(ESC_POS.alignLeft);
  if (isK58 && visualWidth(codeStr) + visualWidth(dateStr) + 1 > widthChars) {
    writeLine(codeStr);
    writeLine(dateStr);
  } else {
    writeLine(padRow(codeStr, dateStr, widthChars));
  }
  writeLine(divider);

  // 4. Metadata Section
  if (template.showTableAreaName && (data.tableName || data.areaName)) {
    const tableArea = sanitize([data.tableName, data.areaName].filter(Boolean).join(' · '));
    writeLine(padRow(sanitize('Khu vuc / Ban:'), tableArea, widthChars));
  }
  if (template.showCashierName && data.cashierName) {
    writeLine(padRow(sanitize('Thu ngan:'), sanitize(data.cashierName), widthChars));
  }
  if (template.showCheckInTime && data.checkInTimeMs) {
    writeLine(padRow(sanitize('Gio vao:'), formatDateTime(data.checkInTimeMs), widthChars));
  }

  const hasCustomerInfo =
    template.showCustomerName ||
    (template.showCustomerPhone && data.guestPhone) ||
    (template.showCustomerAddress && data.guestAddress) ||
    (template.showOrderNote && data.note);

  if (hasCustomerInfo) {
    writeLine(divider);
    if (template.showCustomerName) {
      const customerDisplayName = sanitize(data.customerName?.trim() || 'Khách lẻ');
      writeLine(padRow(sanitize('Khach hang:'), customerDisplayName, widthChars));
    }
    if (template.showCustomerPhone && data.guestPhone) {
      writeLine(padRow(sanitize('Dien thoai:'), sanitize(data.guestPhone), widthChars));
    }
    if (template.showCustomerAddress && data.guestAddress) {
      writeLine(padRow(sanitize('Dia chi:'), sanitize(data.guestAddress), widthChars));
    }
    if (template.showOrderNote && data.note) {
      writeLine(sanitize(`* Ghi chu: ${data.note}`));
    }
  }
  writeLine(divider);

  // Filter time lines vs product lines
  const timeLines = (data.lines || []).filter((l) => l.isTime);
  const productLines = (data.lines || []).filter((l) => !l.isTime);
  const timeTotal = timeLines.reduce((sum, line) => sum + line.totalPrice, 0);
  const goodsTotal = productLines.reduce((sum, line) => sum + line.totalPrice, 0);

  // 5. Section: Hourly Services (Thông tin giờ)
  if (timeLines.length > 0) {
    parts.push(ESC_POS.boldOn);
    if (isK58) {
      writeLine(padRow(sanitize('Thong tin gio'), sanitize('T.Tien'), widthChars));
    } else if (template.showHourlyUnitPrice) {
      // 21 + 1 + 12 + 1 + 13 = 48
      const colName = padEndVisual(sanitize('Thong tin gio'), 21);
      const colPrice = padStartVisual(sanitize('D.Gia'), 12);
      const colTotal = padStartVisual(sanitize('Thanh tien'), 13);
      writeLine(`${colName} ${colPrice} ${colTotal}`);
    } else {
      // 33 + 1 + 14 = 48
      const colName = padEndVisual(sanitize('Thong tin gio'), 33);
      const colTotal = padStartVisual(sanitize('Thanh tien'), 14);
      writeLine(`${colName} ${colTotal}`);
    }
    parts.push(ESC_POS.boldOff);
    writeLine(divider);

    for (const line of timeLines) {
      // Table transfers
      if (
        line.tableSegments &&
        line.tableSegments.length > 1 &&
        (!line.timeSegments || line.timeSegments.length === 0)
      ) {
        writeLine(padRow(sanitize('Chuyen ban'), formatVnd(line.totalPrice), widthChars));
        if (template.showHourlyDetail) {
          for (const tSeg of line.tableSegments) {
            const startClock = formatClock(tSeg.startedAtMs);
            const endClock = tSeg.endedAtMs ? formatClock(tSeg.endedAtMs) : 'Hien tai';
            const dur = formatDuration(tSeg.elapsedSeconds);
            const pricePart = tSeg.hourlyPrice ? ` @ ${formatVnd(tSeg.hourlyPrice)}/h` : '';
            const tSegText = `  * ${sanitize(tSeg.tableName)}: ${startClock}-${endClock} (${dur})${pricePart} = ${formatVnd(tSeg.amount)}`;
            writeLine(tSegText);
          }
          writeLine(
            sanitize(`  = Tong thoi gian: ${formatDuration(line.timeElapsedSeconds || 0)}`),
          );
        }
      } else if (
        template.showHourlyDetail &&
        template.hourlyDetailMode === 'FULL_TIMELOG' &&
        line.timeSegments &&
        line.timeSegments.length > 0
      ) {
        const displaySegments =
          reconcileReceiptTimeSegmentAmounts(line.timeSegments, line.totalPrice) ?? [];
        for (const seg of displaySegments) {
          const startStr = formatTimeOnly(seg.startedAtMs, template.showHourlyTimeWithSeconds);
          const endStr = seg.endedAtMs
            ? formatTimeOnly(seg.endedAtMs, template.showHourlyTimeWithSeconds)
            : 'Hien tai';
          const timeRange = `${startStr} - ${endStr}`;
          const dateOnly = formatDateOnly(seg.startedAtMs);
          const durLabel = sanitize(formatSegmentDurationLabel(seg));
          const unitPriceStr = `${formatVnd(seg.priceVnd)}${template.showHourlyUnitDuration ? '/1h' : ''}`;
          const segTotalStr = formatVnd(seg.amount);

          if (isK58) {
            writeLine(padRow(timeRange, segTotalStr, widthChars));
            writeLine(`  ${dateOnly}  ${durLabel}`);
            if (template.showHourlyUnitPrice) {
              writeLine(`  D.Gia: ${unitPriceStr}`);
            }
          } else if (template.showHourlyUnitPrice) {
            const colName = padEndVisual(timeRange, 21);
            const colPrice = padStartVisual(unitPriceStr, 12);
            const colTotal = padStartVisual(segTotalStr, 13);
            writeLine(`${colName} ${colPrice} ${colTotal}`);
            writeLine(`  ${dateOnly}  ${durLabel}`);
          } else {
            const colName = padEndVisual(timeRange, 33);
            const colTotal = padStartVisual(segTotalStr, 14);
            writeLine(`${colName} ${colTotal}`);
            writeLine(`  ${dateOnly}  ${durLabel}`);
          }
        }
      } else {
        const lineSummary = line.timeElapsedSeconds
          ? sanitize(`Tong thoi gian (${formatDuration(line.timeElapsedSeconds)})`)
          : sanitize('Tong thoi gian');
        const unitPriceStr = `${formatVnd(line.unitPrice)}${template.showHourlyUnitDuration ? '/1h' : ''}`;
        const totalStr = formatVnd(line.totalPrice);

        if (isK58) {
          writeLine(padRow(lineSummary, totalStr, widthChars));
          if (template.showHourlyUnitPrice) {
            writeLine(`  D.Gia: ${unitPriceStr}`);
          }
        } else if (template.showHourlyUnitPrice) {
          const colName = padEndVisual(lineSummary, 21);
          const colPrice = padStartVisual(unitPriceStr, 12);
          const colTotal = padStartVisual(totalStr, 13);
          writeLine(`${colName} ${colPrice} ${colTotal}`);
        } else {
          const colName = padEndVisual(lineSummary, 33);
          const colTotal = padStartVisual(totalStr, 14);
          writeLine(`${colName} ${colTotal}`);
        }

        if (template.showHourlyDetail && line.timeStartedAtMs) {
          const startStr = formatDateTime(line.timeStartedAtMs, template.showHourlyTimeWithSeconds);
          const endStr = line.timeEndedAtMs
            ? formatDateTime(line.timeEndedAtMs, template.showHourlyTimeWithSeconds)
            : 'Hien tai';
          writeLine(`  ${startStr} - ${endStr}`);
        }
      }
    }
    writeLine(divider);
  }

  // 6. Section: Products / Goods (Mặt hàng)
  if (productLines.length > 0) {
    const isSeparateCol =
      !isK58 && template.showItemUnitPrice && template.itemUnitPricePlacement === 'SEPARATE_COLUMN';

    // Layout configuration
    let nameWidth = 27;
    let qtyWidth = 5;
    let priceWidth = 10;
    let totalWidth = 12;

    parts.push(ESC_POS.boldOn);
    if (isK58) {
      nameWidth = 16;
      qtyWidth = 3;
      totalWidth = 11;
      const colName = padEndVisual(sanitize('Mat hang'), nameWidth);
      const colQty = padStartVisual(sanitize('SL'), qtyWidth);
      const colTotal = padStartVisual(sanitize('T.Tien'), totalWidth);
      writeLine(`${colName} ${colQty} ${colTotal}`);
    } else if (isSeparateCol) {
      // 18 + 1 + 5 + 1 + 10 + 1 + 12 = 48
      nameWidth = 18;
      qtyWidth = 5;
      priceWidth = 10;
      totalWidth = 12;
      const colName = padEndVisual(sanitize('Mat hang'), nameWidth);
      const colQty = padStartVisual(sanitize('SL/TL'), qtyWidth);
      const colPrice = padStartVisual(sanitize('D.Gia'), priceWidth);
      const colTotal = padStartVisual(sanitize('Thanh tien'), totalWidth);
      writeLine(`${colName} ${colQty} ${colPrice} ${colTotal}`);
    } else {
      // 27 + 1 + 5 + 1 + 14 = 48
      nameWidth = 27;
      qtyWidth = 5;
      totalWidth = 14;
      const colName = padEndVisual(sanitize('Mat hang'), nameWidth);
      const colQty = padStartVisual(sanitize('SL/TL'), qtyWidth);
      const colTotal = padStartVisual(sanitize('Thanh tien'), totalWidth);
      writeLine(`${colName} ${colQty} ${colTotal}`);
    }
    parts.push(ESC_POS.boldOff);
    writeLine(divider);

    let itemIdx = 1;
    for (const line of productLines) {
      if (template.hideZeroPriceItems && line.totalPrice === 0) continue;

      const prefix = template.showItemIndex ? `${itemIdx}. ` : '';
      itemIdx++;

      const fullName = sanitize(
        `${prefix}${line.name}${template.showItemPriceName ? ' (Gia chuan)' : ''}`,
      );
      const qtyStr = String(line.quantity);
      const priceStr = formatVnd(line.unitPrice);
      const totalStr = formatVnd(line.totalPrice);

      const nameLines = wrapTextToWidth(fullName, nameWidth);

      if (isK58) {
        // Line 1: First part of name + Qty + Total
        const colName = padEndVisual(nameLines[0]!, nameWidth);
        const colQty = padStartVisual(qtyStr, qtyWidth);
        const colTotal = padStartVisual(totalStr, totalWidth);
        writeLine(`${colName} ${colQty} ${colTotal}`);

        // Remaining lines of name
        for (let i = 1; i < nameLines.length; i++) {
          writeLine(nameLines[i]!);
        }
        if (template.showItemUnitPrice) {
          writeLine(`  D.Gia: ${priceStr}`);
        }
      } else if (isSeparateCol) {
        // Line 1: First part of name + Qty + Price + Total
        const colName = padEndVisual(nameLines[0]!, nameWidth);
        const colQty = padStartVisual(qtyStr, qtyWidth);
        const colPrice = padStartVisual(priceStr, priceWidth);
        const colTotal = padStartVisual(totalStr, totalWidth);
        writeLine(`${colName} ${colQty} ${colPrice} ${colTotal}`);

        // Remaining lines of name
        for (let i = 1; i < nameLines.length; i++) {
          writeLine(nameLines[i]!);
        }
      } else {
        // Line 1: First part of name + Qty + Total
        const colName = padEndVisual(nameLines[0]!, nameWidth);
        const colQty = padStartVisual(qtyStr, qtyWidth);
        const colTotal = padStartVisual(totalStr, totalWidth);
        writeLine(`${colName} ${colQty} ${colTotal}`);

        // Remaining lines of name
        for (let i = 1; i < nameLines.length; i++) {
          writeLine(nameLines[i]!);
        }
        if (template.showItemUnitPrice) {
          writeLine(`  Don gia: ${priceStr}`);
        }
      }

      // Sublines: Note, Discounts
      if (template.showItemNote && line.note) {
        writeLine(sanitize(`  * G/chu: ${line.note}`));
      }
      if (template.showItemDiscounts && (line.discountAmount ?? 0) > 0) {
        if (line.adjustmentSource === 'PROMOTION_GIFT') {
          writeLine(
            sanitize(`  * Qua tang KM: -${formatVnd(line.discountAmount ?? 0)}${currencyUnit}`),
          );
          if (line.promotionName) {
            writeLine(sanitize(`  * Chuong trinh: ${line.promotionName}`));
          }
        } else {
          writeLine(
            sanitize(`  * Giam thu cong: -${formatVnd(line.discountAmount ?? 0)}${currencyUnit}`),
          );
          if (line.discountReason) {
            writeLine(sanitize(`  * Ly do: ${line.discountReason}`));
          }
        }
      }
    }
    writeLine(divider);
  }

  // 7. Summary & Totals
  if (timeLines.length > 0) {
    writeLine(padRow(sanitize('Tiền giờ:'), `${formatVnd(timeTotal)} ${currencyUnit}`, widthChars));
  }
  if (productLines.length > 0) {
    writeLine(
      padRow(
        sanitize(`Tiền hàng (${productLines.length}):`),
        `${formatVnd(goodsTotal)} ${currencyUnit}`,
        widthChars,
      ),
    );
  }
  if (
    template.combineGoodsAndServiceTotal &&
    timeLines.length > 0 &&
    productLines.length > 0 &&
    (data.receiptType !== 'PAYMENT' || (data.discountTotal ?? 0) > 0)
  ) {
    writeLine(
      padRow(
        sanitize('Tổng tiền hàng & dịch vụ:'),
        `${formatVnd(timeTotal + goodsTotal)} ${currencyUnit}`,
        widthChars,
      ),
    );
  }

  const promotionDiscount = data.promotionDiscount ?? 0;
  if (template.showProvisionalTotal && promotionDiscount > 0) {
    writeLine(
      padRow(
        sanitize('Tổng tạm tính:'),
        `${formatVnd(timeTotal + goodsTotal)} ${currencyUnit}`,
        widthChars,
      ),
    );
  }

  if (template.showPromotionsList && promotionDiscount > 0) {
    const promotionLines =
      data.promotions && data.promotions.length > 0
        ? data.promotions
        : data.promotion
          ? [data.promotion]
          : [{ name: 'Khuyen mai', type: '', value: null, discountAmountVnd: promotionDiscount }];

    for (const promotion of promotionLines) {
      if (promotion.type === 'FLAT_PRICE' && (promotion.flatPriceItems?.length ?? 0) > 0) {
        writeLine(
          sanitize(
            `KM: ${promotion.name} (Dong gia ${formatVnd(promotion.value ?? 0)}${currencyUnit})`,
          ),
        );
        for (const item of promotion.flatPriceItems ?? []) {
          const variant = item.variantName ? ` - ${item.variantName}` : '';
          writeLine(
            sanitize(`  - ${item.productName}${variant} - SL: ${item.quantityMilli / 1000}`),
          );
        }
        writeLine(
          padRow(
            sanitize('  Giam khuyen mai:'),
            `-${formatVnd(promotion.discountAmountVnd)} ${currencyUnit}`,
            widthChars,
          ),
        );
        continue;
      }
      writeLine(
        padRow(
          sanitize(`KM: ${promotion.name}:`),
          `-${formatVnd(promotion.discountAmountVnd)} ${currencyUnit}`,
          widthChars,
        ),
      );
    }
  }

  // Grand Total (Highlighted)
  const grandLabel = sanitize(
    data.receiptType === 'PROVISIONAL'
      ? 'TONG TAM TINH:'
      : data.receiptType === 'DEBT_PAYMENT'
        ? 'SO TIEN THU:'
        : 'TONG CONG:',
  );
  const grandAmount = `${formatVnd(data.total)} ${currencyUnit}`;

  parts.push(ESC_POS.doubleHeightOn);
  parts.push(ESC_POS.boldOn);
  writeLine(padRow(grandLabel, grandAmount, widthChars));
  parts.push(ESC_POS.resetSize);
  parts.push(ESC_POS.boldOff);

  // 8. Payment Details & Allocations
  if (data.receiptType === 'PAYMENT' && template.showPaymentMethod) {
    const allocations = data.paymentAllocations ?? [];
    const needsAllocationBreakdown =
      allocations.length > 1 || allocations.some((allocation) => allocation.method === 'DEBT');

    if (needsAllocationBreakdown) {
      for (const allocation of allocations) {
        const label = sanitize(
          allocation.method === 'CASH'
            ? 'Tien mat da thu:'
            : allocation.method === 'DEBT'
              ? 'Ghi cong no:'
              : 'Chuyen khoan da thu:',
        );
        writeLine(padRow(label, `${formatVnd(allocation.amountVnd)} ${currencyUnit}`, widthChars));
      }
    } else if (allocations.length === 0 && (data.debtAmountVnd ?? 0) > 0) {
      if ((data.paidAmountVnd ?? 0) > 0) {
        writeLine(
          padRow(
            sanitize('Da thu:'),
            `${formatVnd(data.paidAmountVnd!)} ${currencyUnit}`,
            widthChars,
          ),
        );
      }
      writeLine(
        padRow(
          sanitize('Ghi cong no:'),
          `${formatVnd(data.debtAmountVnd!)} ${currencyUnit}`,
          widthChars,
        ),
      );
    } else if (data.paymentMethod) {
      const methodStr = sanitize(
        data.paymentMethod === 'CASH' ? 'Tien mat' : 'Chuyen khoan (VietQR)',
      );
      writeLine(padRow(sanitize('Hinh thuc thanh toan:'), methodStr, widthChars));

      if (data.paymentMethod === 'CASH' && template.showCashDetails) {
        if (data.cashReceived !== null && data.cashReceived !== undefined) {
          writeLine(
            padRow(
              sanitize('Tien khach dua:'),
              `${formatVnd(data.cashReceived)} ${currencyUnit}`,
              widthChars,
            ),
          );
        }
        if (data.cashChange !== null && data.cashChange !== undefined) {
          writeLine(
            padRow(
              sanitize('Tien thua:'),
              `${formatVnd(data.cashChange)} ${currencyUnit}`,
              widthChars,
            ),
          );
        }
      }
    }
  }

  if (data.receiptType === 'DEBT_PAYMENT') {
    writeLine(
      padRow(
        sanitize('Du no truoc:'),
        `${formatVnd(data.debtBeforeVnd ?? 0)} ${currencyUnit}`,
        widthChars,
      ),
    );
    writeLine(
      padRow(
        sanitize('So tien vua thu:'),
        `${formatVnd(data.debtPaymentVnd ?? data.total)} ${currencyUnit}`,
        widthChars,
      ),
    );
    writeLine(
      padRow(
        sanitize('Du no con lai:'),
        `${formatVnd(data.debtAfterVnd ?? 0)} ${currencyUnit}`,
        widthChars,
      ),
    );
    if (data.referenceCode) {
      writeLine(padRow(sanitize('Ma tham chieu:'), sanitize(data.referenceCode), widthChars));
    }
    if (template.showPaymentMethod) {
      const methodStr = sanitize(data.paymentMethod === 'CASH' ? 'Tien mat' : 'Chuyen khoan');
      writeLine(padRow(sanitize('Phuong thuc:'), methodStr, widthChars));
    }
  }

  // 9. Star Divider
  parts.push(ESC_POS.alignCenter);
  writeLine('----------------*----------------');

  // 10. Bottom Image / VietQR
  const bottomQrContent = options.bottomQrContent || document.media.vietQrPayload;
  if (options.bottomRasterBytes && template.showBottomImage) {
    parts.push(ESC_POS.alignCenter);
    parts.push(options.bottomRasterBytes);
    writeLine();
    if (document.media.bottomDescription) {
      writeLine(sanitize(document.media.bottomDescription));
    }
  } else if (bottomQrContent && template.showBottomImage) {
    parts.push(buildEscPosQrCode(bottomQrContent, isK58 ? 5 : 6));
    // buildEscPosQrCode restores left alignment for following content.
    // The QR description and receipt footer must remain centered.
    parts.push(ESC_POS.alignCenter);
    writeLine();
    if (document.media.bottomDescription) {
      writeLine(sanitize(document.media.bottomDescription));
    }
  }

  // 11. Wi-Fi Info
  if (document.wifi) {
    const wifiText = sanitize(
      `Wi-Fi: ${document.wifi.name || 'Cua hang'}${document.wifi.password ? ` - Pass: ${document.wifi.password}` : ''}`,
    );
    writeLine(wifiText);
  }

  // 12. Footer Lines
  for (const footerLine of document.footer) {
    if (footerLine.bold) parts.push(ESC_POS.boldOn);
    writeLine(sanitize(footerLine.text));
    if (footerLine.bold) parts.push(ESC_POS.boldOff);
  }

  writeLine();
  writeLine();
  writeLine();

  // 13. Open Cash Drawer & Auto Cut
  if (options.openCashDrawer || (printerConfig.openCashDrawer && data.receiptType === 'PAYMENT')) {
    parts.push(ESC_POS.openCashDrawer);
  }
  if (options.autoCut !== false && printerConfig.autoCut !== false) {
    parts.push(ESC_POS.cut);
  }

  // Concatenate parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}
