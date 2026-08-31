import { z } from 'zod';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');

export const revenueReportQuerySchema = z
  .object({
    reportType: z
      .enum(['OVERVIEW', 'PAYMENT_METHOD', 'SERVICE_MODE', 'CANCELLATIONS', 'STAFF_REVENUE'])
      .default('OVERVIEW'),
    employeeId: z.string().uuid().optional().nullable(),
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
      .default('today'),
    dateFrom: dateOnlySchema.optional().nullable(),
    dateTo: dateOnlySchema.optional().nullable(),
    hourMode: z.enum(['all', 'custom']).default('all'),
    fromHour: z.coerce.number().int().min(0).max(23).default(0),
    fromMinute: z.coerce.number().int().min(0).max(59).default(0),
    toHour: z.coerce.number().int().min(0).max(23).default(0),
    toMinute: z.coerce.number().int().min(0).max(59).default(0),
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

export const printRevenueReportSchema = revenueReportQuerySchema.and(
  z.object({
    targetDeviceId: z.string().uuid().nullable().optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }),
);

export type RevenueReportQuery = z.infer<typeof revenueReportQuerySchema>;
export type RevenueReportType = RevenueReportQuery['reportType'];
export const revenueReportTypePermissions: Record<RevenueReportType, string> = {
  OVERVIEW: 'report.revenue',
  PAYMENT_METHOD: 'report.revenue.payment',
  SERVICE_MODE: 'report.revenue.service',
  CANCELLATIONS: 'report.revenue.cancelled',
  STAFF_REVENUE: 'report.revenue.staff',
};
export const revenueReportViewPermissions = Object.values(revenueReportTypePermissions);
export type RevenueReportTimeRange = RevenueReportQuery['timeRange'];
export type RevenueReportTimelineGranularity = 'hour' | 'day' | 'month';

export interface RevenueReportSummaryDto {
  completedInvoiceCount: number;
  cancelledOrderCount: number;
  productQuantity: number;
  /** Gross product revenue before discounts. Optional for persisted legacy print snapshots. */
  goodsRevenue?: number;
  /** Gross table-time revenue before discounts. Optional for persisted legacy print snapshots. */
  timeRevenue?: number;
  grossRevenue: number;
  cancelledAmount: number;
  discountAmount: number;
  netRevenue: number;
  averageItemsPerInvoice: number;
  averageRevenuePerInvoice: number;
}

export interface RevenueReportHourlyPointDto {
  hour: number;
  label: string;
  averageRevenue: number;
  invoiceCount: number;
}

export interface RevenueReportTimelineRowDto {
  key: string;
  label: string;
  completedInvoiceCount: number;
  cancelledOrderCount: number;
  grossRevenue: number;
  cancelledAmount: number;
  discountAmount: number;
  netRevenue: number;
  averageRevenuePerInvoice: number;
}

export interface RevenueReportBreakdownDto {
  key: string;
  label: string;
  invoiceCount: number;
  amount: number;
  percentage: number;
}

export interface RevenueReportStaffRowDto extends RevenueReportBreakdownDto {
  userId: string;
  roleName: string | null;
}

export interface RevenueReportStaffOptionDto {
  userId: string;
  displayName: string;
  roleName: string | null;
}

export interface RevenueReportCancellationRowDto {
  id: string;
  cancelledAt: number;
  amount: number;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  cancelledByName: string;
  reason: string;
}

export interface RevenueReportResponseDto {
  reportType: RevenueReportType;
  selectedEmployeeId: string | null;
  timeRange: RevenueReportTimeRange;
  timezone: string;
  businessDayCutoffMinutes: number;
  fromMs: number;
  toMs: number;
  generatedAt: number;
  dayCount: number;
  timelineGranularity: RevenueReportTimelineGranularity;
  summary: RevenueReportSummaryDto;
  hourlyAverage: RevenueReportHourlyPointDto[];
  timeline: RevenueReportTimelineRowDto[];
  paymentMethods: RevenueReportBreakdownDto[];
  orderTypes: RevenueReportBreakdownDto[];
  staffRevenue: RevenueReportStaffRowDto[];
  staffOptions: RevenueReportStaffOptionDto[];
  cancellations: RevenueReportCancellationRowDto[];
}

export interface RevenueReportPrintSnapshotDto {
  id: string;
  storeId: string;
  requestedByName: string;
  report: RevenueReportResponseDto;
  createdAt: number;
  expiresAt: number;
}
