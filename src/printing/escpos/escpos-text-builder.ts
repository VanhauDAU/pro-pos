import { ESC_POS } from './escpos-commands';
import type { PosReceiptPrintData } from '@domain/receipt/receipt-generator';

export interface EscPosTextBuilderOptions {
  paperSize?: 'K80' | 'K58' | undefined;
  autoCut?: boolean | undefined;
  openCashDrawer?: boolean | undefined;
  storeName?: string | undefined;
  storeAddress?: string | undefined;
  storePhone?: string | undefined;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
}

export function buildEscPosTextReceipt(
  data: PosReceiptPrintData,
  options: EscPosTextBuilderOptions = {},
): Uint8Array {
  const isK58 = options.paperSize === 'K58';
  const widthChars = isK58 ? 32 : 48;
  const divider = '='.repeat(widthChars) + '\n';
  const thinDivider = '-'.repeat(widthChars) + '\n';

  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const writeLine = (text = '') => {
    parts.push(encoder.encode(text + '\n'));
  };

  const padRow = (left: string, right: string) => {
    const space = widthChars - left.length - right.length;
    if (space <= 0) return `${left} ${right}\n`;
    return `${left}${' '.repeat(space)}${right}\n`;
  };

  // 1. Initialize
  parts.push(ESC_POS.initialize);

  // 2. Header (Center)
  parts.push(ESC_POS.alignCenter);
  // Double height & double width for store name
  parts.push(Uint8Array.of(0x1b, 0x21, 0x30));
  writeLine(options.storeName || 'PRO POS');
  // Normal font
  parts.push(Uint8Array.of(0x1b, 0x21, 0x00));

  if (options.storeAddress) writeLine(options.storeAddress);
  if (options.storePhone) writeLine(`Hotline: ${options.storePhone}`);
  writeLine();

  // Receipt Title
  parts.push(Uint8Array.of(0x1b, 0x21, 0x20)); // Bold + Double height
  const title =
    data.receiptType === 'PROVISIONAL'
      ? 'PHIẾU TẠM TÍNH'
      : data.receiptType === 'DEBT_PAYMENT'
        ? 'PHIẾU THU NỢ'
        : 'HÓA ĐƠN THANH TOÁN';
  writeLine(title);
  parts.push(Uint8Array.of(0x1b, 0x21, 0x00)); // Reset
  writeLine();

  // 3. Info metadata (Left aligned)
  parts.push(ESC_POS.alignLeft);
  writeLine(
    padRow(
      `HĐ: ${data.orderCode || data.invoiceCode || ''}`,
      formatDateTime(data.issuedAtMs || Date.now()),
    ),
  );
  if (data.tableName) writeLine(`Bàn / Khu vực: ${data.tableName}`);
  if (data.customerName) writeLine(`Khách hàng: ${data.customerName}`);
  if (data.cashierName) writeLine(`Thu ngân: ${data.cashierName}`);
  writeLine(divider);

  // 4. Line Items Table Header
  if (isK58) {
    writeLine(padRow('Món / Đơn giá x SL', 'Thành tiền'));
  } else {
    writeLine(padRow('Tên món', 'SL   Đơn giá   T.Tiền'));
  }
  writeLine(thinDivider);

  // Line items
  if (data.lines && data.lines.length > 0) {
    for (const line of data.lines) {
      if (line.isTime) {
        // Time item
        const timeStr = line.timeStartedAtMs
          ? `${formatClock(line.timeStartedAtMs)} - ${line.timeEndedAtMs ? formatClock(line.timeEndedAtMs) : 'Hiện tại'}`
          : '';
        const totalStr = formatMoney(line.totalPrice);
        writeLine(padRow(`${line.name} ${timeStr ? '(' + timeStr + ')' : ''}`, totalStr));
      } else {
        const priceStr = formatMoney(line.unitPrice);
        const totalStr = formatMoney(line.totalPrice);
        if (isK58) {
          writeLine(line.name);
          writeLine(padRow(`  ${priceStr} x ${line.quantity}`, totalStr));
        } else {
          const namePart =
            line.name.length > 20 ? line.name.slice(0, 19) + '…' : line.name.padEnd(20);
          const qtyPart = String(line.quantity).padStart(4);
          const pricePart = priceStr.padStart(10);
          const amountPart = totalStr.padStart(11);
          writeLine(`${namePart} ${qtyPart} ${pricePart} ${amountPart}`);
        }
      }
    }
    writeLine(thinDivider);
  }

  // 5. Summary totals
  if (data.subtotal && data.subtotal !== data.total) {
    writeLine(padRow('Tạm tính:', `${formatMoney(data.subtotal)} đ`));
  }
  if (data.discountTotal) {
    writeLine(padRow('Giảm giá:', `-${formatMoney(data.discountTotal)} đ`));
  }

  // Grand Total (Bold + Double Height)
  writeLine(divider);
  parts.push(Uint8Array.of(0x1b, 0x21, 0x20)); // Bold & Double height
  writeLine(padRow('TỔNG TIỀN:', `${formatMoney(data.total)} đ`));
  parts.push(Uint8Array.of(0x1b, 0x21, 0x00));
  writeLine(divider);

  // Payment details
  if (data.receiptType === 'PAYMENT') {
    const methodLabel =
      data.paymentMethod === 'CASH'
        ? 'Tiền mặt'
        : data.paymentMethod === 'BANK_TRANSFER'
          ? 'Chuyển khoản'
          : data.paymentMethod || 'Tiền mặt';
    writeLine(padRow('Hình thức TT:', methodLabel));
    if (data.cashReceived) writeLine(padRow('Khách đưa:', `${formatMoney(data.cashReceived)} đ`));
    if (data.cashChange) writeLine(padRow('Tiền thừa:', `${formatMoney(data.cashChange)} đ`));
  }

  // 6. Footer
  writeLine();
  parts.push(ESC_POS.alignCenter);
  writeLine('Cảm ơn Quý khách & Hẹn gặp lại!');
  writeLine('Pro POS - Hân hạnh phục vụ');
  writeLine();
  writeLine();
  writeLine();

  // 7. Cut & Open Drawer
  if (options.openCashDrawer) {
    parts.push(ESC_POS.openCashDrawer);
  }
  if (options.autoCut !== false) {
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
