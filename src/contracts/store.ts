import { z } from 'zod';

/** Vietnamese mobile (10 digits) and landline (10–11 digits) numbers. */
export const VIETNAM_PHONE_REGEX = /^(?:02\d{8,9}|0[35789]\d{8})$/;

export const updateStoreSettingsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z
    .string()
    .trim()
    .max(11)
    .regex(VIETNAM_PHONE_REGEX, 'Số điện thoại không đúng định dạng Việt Nam.')
    .nullable()
    .optional(),
  address: z.string().trim().min(1).max(500),
  provinceCode: z.number().int().positive().nullable().optional(),
  provinceName: z.string().trim().max(120).nullable().optional(),
  wardCode: z.number().int().positive().nullable().optional(),
  wardName: z.string().trim().max(120).nullable().optional(),
  businessDayCutoffMinutes: z.number().int().min(0).max(1439),
  bankName: z.string().trim().max(120).nullable().optional(),
  bankAccountNumber: z.string().trim().max(64).nullable().optional(),
  bankAccountName: z.string().trim().max(160).nullable().optional(),
  bankQrMediaId: z.string().uuid().nullable().optional(),
});

export interface PrintTemplateDisplayConfig {
  // 1. Thông tin chung
  showLogo: boolean;

  // 2. Thông tin đơn hàng
  showTableAreaName: boolean;
  showCashierName: boolean;
  showCheckInTime: boolean;
  showCustomerName: boolean;
  showCustomerPhone: boolean;
  showCustomerAddress: boolean;
  showOrderNote: boolean;

  // 3. Thông tin mặt hàng
  itemFontSize: 'SMALL' | 'MEDIUM' | 'LARGE';
  showItemTableBorder: boolean;
  showItemIndex: boolean;
  showItemNote: boolean;
  showItemDiscounts: boolean;

  // 4. Thông tin giờ
  showHourlyDetail: boolean;
  hourlyDetailMode: 'FULL_TIMELOG' | 'TOTAL_ONLY';
  showHourlyUnitPrice: boolean;
  showHourlyUnitDuration: boolean;
  showHourlyTimeWithSeconds: boolean;

  // 5. Mặt hàng
  showItemPriceName: boolean;
  showItemUnitPrice: boolean;
  itemUnitPricePlacement: 'INLINE' | 'SEPARATE_COLUMN';
  hideZeroPriceItems: boolean;

  // 6. Thông tin thanh toán
  combineGoodsAndServiceTotal: boolean;
  showPromotionsList: boolean;
  showProvisionalTotal: boolean;
  showPaymentMethod: boolean;
  showCashDetails: boolean;
  showBottomImage: boolean;
}

const basePrintTemplateConfig: PrintTemplateDisplayConfig = {
  showLogo: true,
  showTableAreaName: true,
  showCashierName: true,
  showCheckInTime: true,
  showCustomerName: true,
  showCustomerPhone: true,
  showCustomerAddress: true,
  showOrderNote: true,
  itemFontSize: 'MEDIUM',
  showItemTableBorder: false,
  showItemIndex: true,
  showItemNote: true,
  showItemDiscounts: true,
  showHourlyDetail: true,
  hourlyDetailMode: 'FULL_TIMELOG',
  showHourlyUnitPrice: true,
  showHourlyUnitDuration: true,
  showHourlyTimeWithSeconds: false,
  showItemPriceName: true,
  showItemUnitPrice: true,
  itemUnitPricePlacement: 'SEPARATE_COLUMN',
  hideZeroPriceItems: false,
  combineGoodsAndServiceTotal: true,
  showPromotionsList: true,
  showProvisionalTotal: true,
  showPaymentMethod: true,
  showCashDetails: true,
  showBottomImage: true,
};

export const defaultProvisionalPrintTemplateConfig: PrintTemplateDisplayConfig = {
  ...basePrintTemplateConfig,
  showCustomerPhone: false,
  showCustomerAddress: false,
  showPaymentMethod: false,
  showCashDetails: false,
  showBottomImage: false,
};

export const defaultPaymentPrintTemplateConfig: PrintTemplateDisplayConfig = {
  ...basePrintTemplateConfig,
  showCustomerAddress: false,
  showPaymentMethod: true,
  showCashDetails: true,
  showBottomImage: true,
};

/** Backward-compatible default for callers that do not specify a receipt type. */
export const defaultPrintTemplateConfig = defaultPaymentPrintTemplateConfig;

export function defaultPrintTemplateConfigFor(
  type: keyof PrintTemplateSettingsMap,
): PrintTemplateDisplayConfig {
  return type === 'PROVISIONAL'
    ? defaultProvisionalPrintTemplateConfig
    : defaultPaymentPrintTemplateConfig;
}

export interface PrintTemplateSettingsMap {
  PROVISIONAL: PrintTemplateDisplayConfig;
  PAYMENT: PrintTemplateDisplayConfig;
}

export function parsePrintTemplateConfigs(jsonStr?: string | null): PrintTemplateSettingsMap {
  if (!jsonStr) {
    return {
      PROVISIONAL: { ...defaultProvisionalPrintTemplateConfig },
      PAYMENT: { ...defaultPaymentPrintTemplateConfig },
    };
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object') {
      if (parsed.PROVISIONAL || parsed.PAYMENT) {
        return {
          PROVISIONAL: {
            ...defaultProvisionalPrintTemplateConfig,
            ...parsed.PROVISIONAL,
          },
          PAYMENT: { ...defaultPaymentPrintTemplateConfig, ...parsed.PAYMENT },
        };
      }
      return {
        PROVISIONAL: { ...defaultProvisionalPrintTemplateConfig, ...parsed },
        PAYMENT: { ...defaultPaymentPrintTemplateConfig, ...parsed },
      };
    }
  } catch {
    // fallback to defaults
  }
  return {
    PROVISIONAL: { ...defaultProvisionalPrintTemplateConfig },
    PAYMENT: { ...defaultPaymentPrintTemplateConfig },
  };
}

export type PaperSize = 'K80' | 'K58';

export interface ReceiptPrintProfile {
  paperSize: PaperSize;
  paperWidthMm: number;
  printableWidthMm: number;
  defaultPrintableDots: number;
  dpi: number;
  charsPerLineFontA: number;
  charsPerLineFontB: number;
  maxLogoWidthPx: number;
  maxQrSizePx: number;
  previewWidthPx: number;
  previewOuterWidthPx: number;
  layoutMode: 'MULTI_COLUMN' | 'COMPACT_STACK';
  baseFontSizePx: number;
}

export const RECEIPT_PRINT_PROFILES: Record<PaperSize, ReceiptPrintProfile> = {
  K80: {
    paperSize: 'K80',
    paperWidthMm: 80,
    printableWidthMm: 72,
    defaultPrintableDots: 576,
    dpi: 203,
    charsPerLineFontA: 48,
    charsPerLineFontB: 64,
    maxLogoWidthPx: 120,
    maxQrSizePx: 110,
    previewWidthPx: 288,
    previewOuterWidthPx: 320,
    layoutMode: 'MULTI_COLUMN',
    baseFontSizePx: 12,
  },
  K58: {
    paperSize: 'K58',
    paperWidthMm: 58,
    printableWidthMm: 52.5,
    defaultPrintableDots: 420,
    dpi: 203,
    charsPerLineFontA: 35,
    charsPerLineFontB: 46,
    maxLogoWidthPx: 85,
    maxQrSizePx: 80,
    previewWidthPx: 210,
    previewOuterWidthPx: 232,
    layoutMode: 'COMPACT_STACK',
    baseFontSizePx: 10.5,
  },
};

export function getReceiptPrintProfile(
  paperSize: PaperSize = 'K80',
  customDots?: number | null,
): ReceiptPrintProfile {
  const base = RECEIPT_PRINT_PROFILES[paperSize] ?? RECEIPT_PRINT_PROFILES.K80;
  if (customDots && customDots > 0) {
    return {
      ...base,
      defaultPrintableDots: customDots,
    };
  }
  return base;
}

export interface PrinterDeviceConfig {
  connectionType: 'SYSTEM' | 'NETWORK_TCP';
  printerName?: string | undefined;
  networkIp?: string | undefined;
  networkPort?: number | undefined;
  paperSize: PaperSize;
  printableDots?: number | undefined;
  autoCut: boolean;
  openCashDrawer: boolean;
}

export const defaultPrinterDeviceConfig: PrinterDeviceConfig = {
  connectionType: 'SYSTEM',
  printerName: '',
  networkIp: '192.168.1.150',
  networkPort: 9100,
  paperSize: 'K80',
  printableDots: undefined,
  autoCut: true,
  openCashDrawer: false,
};

export function parsePrinterDeviceConfig(jsonStr?: string | null): PrinterDeviceConfig {
  if (!jsonStr) return { ...defaultPrinterDeviceConfig };
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      ...defaultPrinterDeviceConfig,
      ...parsed,
    };
  } catch {
    return { ...defaultPrinterDeviceConfig };
  }
}

export const updatePrinterDeviceSettingsSchema = z
  .object({
    connectionType: z.enum(['SYSTEM', 'NETWORK_TCP']),
    printerName: z.string().trim().max(255).optional(),
    networkIp: z.string().trim().max(255).optional(),
    networkPort: z.number().int().min(1).max(65535).optional(),
    paperSize: z.enum(['K80', 'K58']),
    printableDots: z.number().int().min(200).max(1200).optional(),
    autoCut: z.boolean(),
    openCashDrawer: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.connectionType === 'SYSTEM' && !value.printerName) {
      context.addIssue({
        code: 'custom',
        path: ['printerName'],
        message: 'Vui lòng chọn máy in hệ thống.',
      });
    }
    if (value.connectionType === 'NETWORK_TCP' && !value.networkIp) {
      context.addIssue({
        code: 'custom',
        path: ['networkIp'],
        message: 'Vui lòng nhập địa chỉ IP máy in.',
      });
    }
  });

export type UpdatePrinterDeviceSettingsInput = z.infer<typeof updatePrinterDeviceSettingsSchema>;

export const updatePrintSettingsSchema = z.object({
  maxReceiptReprintCount: z.number().int().min(0).max(999).default(0),
  paymentCopyCount: z.number().int().min(1).max(9).default(1),
  allowProvisionalPrint: z.boolean().default(true),
  provisionalCopyCount: z.number().int().min(1).max(9).default(1),
  logoHorizontalLayout: z.boolean().default(false),
  logoMediaId: z.string().uuid().nullable().optional(),
  bottomImageDescription: z.string().trim().max(90).nullable().optional(),
  bottomImageType: z.enum(['UPLOAD', 'VIETQR', 'NONE']).default('UPLOAD'),
  bottomImageMediaId: z.string().uuid().nullable().optional(),
  bottomBankName: z.string().trim().max(120).nullable().optional(),
  bottomBankAccountNumber: z.string().trim().max(64).nullable().optional(),
  bottomBankAccountName: z.string().trim().max(160).nullable().optional(),
  customAddressEnabled: z.boolean().default(false),
  customAddress: z.string().trim().max(500).nullable().optional(),
  footerLine1: z.string().trim().max(255).nullable().optional(),
  footerLine1Bold: z.boolean().default(false),
  footerLine2: z.string().trim().max(255).nullable().optional(),
  footerLine2Bold: z.boolean().default(true),
  printWifiEnabled: z.boolean().default(false),
  wifiName: z.string().trim().max(100).nullable().optional(),
  wifiPassword: z.string().trim().max(100).nullable().optional(),
  paperSize: z.enum(['K80', 'K58']).default('K80'),
  printersJson: z.string().nullable().optional(),
  templateConfigJson: z.string().nullable().optional(),
});

export type UpdatePrintSettingsInput = z.infer<typeof updatePrintSettingsSchema>;

export interface StorePrintSettings extends UpdatePrintSettingsInput {
  storeId: string;
  updatedAt: number;
}
