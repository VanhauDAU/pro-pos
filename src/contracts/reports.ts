import { z } from 'zod';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
    );
  }, 'Ngày không hợp lệ');

export const productReportQuerySchema = z
  .object({
    reportType: z
      .enum([
        'CATEGORY',
        'TOP_SELLING',
        'MODIFIER_CATEGORY',
        'TOP_COMBO',
        'CANCELLED_ITEMS',
        'CANCELLED_COMBOS',
      ])
      .default('CATEGORY'),
    timeRange: z
      .enum([
        'today',
        'yesterday',
        'last_7_days',
        'this_week',
        'last_week',
        'this_month',
        'last_month',
        'this_year',
        'custom',
      ])
      .default('this_week'),
    dateFrom: dateOnlySchema.optional().nullable(),
    dateTo: dateOnlySchema.optional().nullable(),
    hourMode: z.enum(['all', 'custom']).default('all'),
    fromHour: z.coerce.number().int().min(0).max(23).default(0),
    fromMinute: z.coerce.number().int().min(0).max(59).default(0),
    toHour: z.coerce.number().int().min(0).max(23).default(0),
    toMinute: z.coerce.number().int().min(0).max(59).default(0),
    compareWith: z
      .enum([
        'previous_period',
        'same_period_last_week',
        'same_period_last_month',
        'same_period_last_year',
        'none',
      ])
      .default('previous_period'),
  })
  .superRefine((value, context) => {
    if (value.timeRange !== 'custom') return;
    if (!value.dateFrom || !value.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateFrom'],
        message: 'Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc.',
      });
      return;
    }
    if (value.dateFrom > value.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
      });
    }
  });

export type ProductReportQueryInput = z.infer<typeof productReportQuerySchema>;

export type ProductReportType =
  | 'CATEGORY'
  | 'TOP_SELLING'
  | 'MODIFIER_CATEGORY'
  | 'TOP_COMBO'
  | 'CANCELLED_ITEMS'
  | 'CANCELLED_COMBOS';

export type ProductReportTimeRange =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'custom';

export type ProductReportHourRange = 'all' | 'morning' | 'afternoon' | 'evening' | 'custom';
export type ProductReportCompareWith =
  | 'previous_period'
  | 'same_period_last_week'
  | 'same_period_last_month'
  | 'same_period_last_year'
  | 'none';

export interface ProductReportCategoryProductItem {
  productId: string;
  productCode: string;
  productName: string;
  unitName: string;
  quantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface ProductReportCategoryRow {
  categoryId: string;
  categoryName: string;
  unitName: string;
  quantity: number;
  quantityRatio: number;
  grossAmount: number;
  grossAmountRatio: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  products: ProductReportCategoryProductItem[];
}

export interface ProductReportTopSellingRow {
  rank: number;
  productId: string;
  productCode: string;
  productName: string;
  categoryName: string;
  unitName: string;
  quantity: number;
  quantityRatio: number;
  grossAmount: number;
  grossAmountRatio: number;
  discountAmount: number;
  netAmount: number;
  averagePrice: number;
}

export interface ProductReportModifierRow {
  groupName: string;
  optionName: string;
  quantity: number;
  quantityRatio: number;
  totalAmount: number;
  amountRatio: number;
}

export interface ProductReportComboRow {
  comboId: string;
  comboName: string;
  itemDetails: string;
  quantity: number;
  quantityRatio: number;
  grossAmount: number;
  grossAmountRatio: number;
  totalAmount: number;
}

export interface ProductReportCancelledRow {
  id: string;
  productName: string;
  categoryName: string;
  unitName: string;
  quantity: number;
  totalAmount: number;
  cancelReason: string;
  cancelledAt: number;
  cancelledByName: string;
}

export interface ProductReportComparisonDto {
  quantityGrowth: number;
  grossAmountGrowth: number;
  discountGrowth: number;
  netAmountGrowth: number;
}

export interface ProductReportSummaryDto {
  totalQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  comparison: ProductReportComparisonDto | null;
}

export interface ProductReportChartSlice {
  key: string;
  label: string;
  value: number;
  percentage: number;
  color: string;
}

export interface ProductReportResponseDto {
  reportType: ProductReportType;
  timeRange: ProductReportTimeRange;
  fromMs: number;
  toMs: number;
  compareFromMs: number | null;
  compareToMs: number | null;
  generatedAt: number;
  summary: ProductReportSummaryDto;
  chart: ProductReportChartSlice[];
  quantityChart: ProductReportChartSlice[];
  categoryRows: ProductReportCategoryRow[];
  topSellingRows: ProductReportTopSellingRow[];
  modifierRows: ProductReportModifierRow[];
  comboRows: ProductReportComboRow[];
  cancelledRows: ProductReportCancelledRow[];
}

export interface ProductReportDetailRow {
  invoiceId: string;
  referenceCode: string;
  issuedAt: number;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  quantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface ProductReportDetailResponseDto {
  productId: string;
  productCode: string;
  productName: string;
  categoryName: string;
  unitName: string;
  fromMs: number;
  toMs: number;
  summary: ProductReportSummaryDto;
  rows: ProductReportDetailRow[];
}
