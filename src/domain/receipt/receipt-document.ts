import {
  getReceiptPrintProfile,
  parsePrinterDeviceConfig,
  parsePrintTemplateConfigs,
  type PaperSize,
  type PrintTemplateDisplayConfig,
  type ReceiptPrintProfile,
} from '@contracts/store';
import type { PosReceiptPrintData, PosReceiptPrintOptions } from './receipt-generator';

function emvField(id: string, value: string): string {
  const length = new TextEncoder().encode(value).length;
  if (length > 99) throw new Error(`VietQR field ${id} vượt quá 99 byte.`);
  return `${id}${String(length).padStart(2, '0')}${value}`;
}

function crc16Ccitt(value: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Builds the actual NAPAS/VietQR EMV payload that banking apps consume. */
export function buildVietQrPaymentPayload(input: {
  bankBin: string;
  accountNumber: string;
  amountVnd?: number;
  transferContent?: string;
}): string {
  const bankBin = input.bankBin.trim();
  const accountNumber = input.accountNumber.replace(/\s+/gu, '');
  if (!/^\d{6}$/u.test(bankBin)) {
    throw new Error('VietQR cần mã BIN ngân hàng gồm 6 chữ số.');
  }
  if (!/^[A-Za-z0-9]{1,32}$/u.test(accountNumber)) {
    throw new Error('Số tài khoản VietQR không hợp lệ.');
  }
  const beneficiary = emvField('00', bankBin) + emvField('01', accountNumber);
  const merchantAccount =
    emvField('00', 'A000000727') + emvField('01', beneficiary) + emvField('02', 'QRIBFTTA');
  const content = input.transferContent?.trim().slice(0, 50) ?? '';
  const additionalData = content ? emvField('08', content) : '';
  const amount = Math.max(0, Math.round(input.amountVnd ?? 0));
  const isDynamic = amount > 0 || Boolean(content);
  const body =
    emvField('00', '01') +
    emvField('01', isDynamic ? '12' : '11') +
    emvField('38', merchantAccount) +
    emvField('53', '704') +
    (amount > 0 ? emvField('54', String(amount)) : '') +
    emvField('58', 'VN') +
    (additionalData ? emvField('62', additionalData) : '');
  const withCrcHeader = `${body}6304`;
  return `${withCrcHeader}${crc16Ccitt(withCrcHeader)}`;
}

export interface ReceiptDocument {
  data: PosReceiptPrintData;
  template: PrintTemplateDisplayConfig;
  paperSize: PaperSize;
  profile: ReceiptPrintProfile;
  isK58: boolean;
  title: 'HÓA ĐƠN TẠM TÍNH' | 'HÓA ĐƠN THANH TOÁN' | 'PHIẾU THU CÔNG NỢ';
  store: {
    name: string;
    address: string;
    phone: string;
  };
  media: {
    logoUrl: string | null;
    bottomImageUrl: string | null;
    vietQrPayload: string | null;
    bottomDescription: string;
  };
  footer: Array<{ text: string; bold: boolean }>;
  wifi: { name: string; password: string } | null;
}

export function createReceiptDocument(options: PosReceiptPrintOptions): ReceiptDocument {
  const settings = options.printSettings;
  const configs = parsePrintTemplateConfigs(settings?.templateConfigJson);
  const template =
    options.data.receiptType === 'PROVISIONAL' ? configs.PROVISIONAL : configs.PAYMENT;
  const printer = parsePrinterDeviceConfig(settings?.printersJson);
  const paperSize = settings?.paperSize || printer.paperSize || 'K80';
  const profile = getReceiptPrintProfile(paperSize, printer.printableDots);

  const lines = options.data.lines
    .filter((line) => !(template.hideZeroPriceItems && line.totalPrice === 0))
    .map((line) => ({
      ...line,
      note: template.showItemNote ? line.note : null,
      discountAmount: template.showItemDiscounts ? line.discountAmount : 0,
      discountReason: template.showItemDiscounts ? line.discountReason : null,
      promotionName: template.showItemDiscounts ? line.promotionName : null,
      timeStartedAtMs: line.isTime && !template.showHourlyDetail ? undefined : line.timeStartedAtMs,
      timeEndedAtMs: line.isTime && !template.showHourlyDetail ? undefined : line.timeEndedAtMs,
      timeElapsedSeconds:
        line.isTime && !template.showHourlyDetail ? undefined : line.timeElapsedSeconds,
      timeSegments: line.isTime && !template.showHourlyDetail ? undefined : line.timeSegments,
      tableSegments: line.isTime && !template.showHourlyDetail ? undefined : line.tableSegments,
    }));

  const data: PosReceiptPrintData = {
    ...options.data,
    tableName: template.showTableAreaName ? options.data.tableName : null,
    areaName: template.showTableAreaName ? options.data.areaName : null,
    cashierName: template.showCashierName ? options.data.cashierName : null,
    checkInTimeMs: template.showCheckInTime ? options.data.checkInTimeMs : null,
    customerName: template.showCustomerName ? options.data.customerName : null,
    guestPhone: template.showCustomerPhone ? options.data.guestPhone : null,
    guestAddress: template.showCustomerAddress ? options.data.guestAddress : null,
    note: template.showOrderNote ? options.data.note : null,
    promotion: template.showPromotionsList ? options.data.promotion : null,
    promotions: template.showPromotionsList ? options.data.promotions : [],
    paymentMethod: template.showPaymentMethod ? options.data.paymentMethod : null,
    cashReceived:
      template.showPaymentMethod && template.showCashDetails ? options.data.cashReceived : null,
    cashChange:
      template.showPaymentMethod && template.showCashDetails ? options.data.cashChange : null,
    lines,
  };

  const storeName = options.storeInfo?.storeName?.trim() || '';
  const storeAddress =
    (settings?.customAddressEnabled
      ? settings.customAddress
      : options.storeInfo?.address
    )?.trim() || '';
  const storePhone = options.storeInfo?.phone?.trim() || '';
  const showBottom = template.showBottomImage && data.receiptType === 'PAYMENT';
  const bankIdentifier = (settings?.bottomBankName || options.storeInfo?.bankName || '').trim();
  const accountNumber = (
    settings?.bottomBankAccountNumber ||
    options.storeInfo?.bankAccountNumber ||
    ''
  ).trim();
  const accountName = (
    settings?.bottomBankAccountName ||
    options.storeInfo?.bankAccountName ||
    ''
  ).trim();

  let bottomImageUrl: string | null = null;
  let vietQrPayload: string | null = null;
  if (showBottom && settings?.bottomImageType === 'UPLOAD' && settings.bottomImageMediaId) {
    bottomImageUrl = `/api/v1/media/${settings.bottomImageMediaId}`;
  } else if (
    showBottom &&
    settings?.bottomImageType === 'VIETQR' &&
    bankIdentifier &&
    accountNumber
  ) {
    const accountNameQuery = accountName ? `?accountName=${encodeURIComponent(accountName)}` : '';
    bottomImageUrl = `https://img.vietqr.io/image/${encodeURIComponent(bankIdentifier)}-${encodeURIComponent(accountNumber)}-qr_only.png${accountNameQuery}`;
    try {
      vietQrPayload = buildVietQrPaymentPayload({
        bankBin: bankIdentifier,
        accountNumber,
      });
    } catch {
      // Legacy settings stored a bank short name. Preview can still load the VietQR image,
      // but ESC/POS must not encode that image URL as a payment QR.
      vietQrPayload = null;
    }
  }

  return {
    data,
    template,
    paperSize,
    profile,
    isK58: paperSize === 'K58',
    title:
      data.receiptType === 'PROVISIONAL'
        ? 'HÓA ĐƠN TẠM TÍNH'
        : data.receiptType === 'DEBT_PAYMENT'
          ? 'PHIẾU THU CÔNG NỢ'
          : 'HÓA ĐƠN THANH TOÁN',
    store: { name: storeName, address: storeAddress, phone: storePhone },
    media: {
      logoUrl:
        template.showLogo && settings?.logoMediaId ? `/api/v1/media/${settings.logoMediaId}` : null,
      bottomImageUrl,
      vietQrPayload,
      bottomDescription: settings?.bottomImageDescription?.trim() || '',
    },
    footer: [
      settings?.footerLine1
        ? { text: settings.footerLine1, bold: Boolean(settings.footerLine1Bold) }
        : null,
      settings?.footerLine2
        ? { text: settings.footerLine2, bold: Boolean(settings.footerLine2Bold) }
        : null,
    ].filter((line): line is { text: string; bold: boolean } => line !== null),
    wifi:
      settings?.printWifiEnabled && (settings.wifiName || settings.wifiPassword)
        ? { name: settings.wifiName || '', password: settings.wifiPassword || '' }
        : null,
  };
}
