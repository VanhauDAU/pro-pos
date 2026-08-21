import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  range: z.enum(['today', 'yesterday', 'week', 'month', 'year', 'custom']).default('today'),
  dateFrom: z.string().optional().nullable(),
  dateTo: z.string().optional().nullable(),
});

export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>;

export interface DashboardPieSlice {
  key: string;
  label: string;
  value: number;
  percentage: number;
  color: string;
}

export interface DashboardTimelinePoint {
  label: string;
  revenue: number;
  invoiceCount: number;
}

export interface DashboardPaymentTimePoint {
  hour: number;
  hourLabel: string;
  revenue: number;
  invoiceCount: number;
}

export interface DashboardStaffRevenueRow {
  userId: string;
  displayName: string;
  roleName: string | null;
  amount: number;
  invoiceCount: number;
}

export interface DashboardTopProductSlice {
  productId: string;
  productName: string;
  unitName: string | null;
  value: number;
  percentage: number;
  color: string;
}

export interface DashboardDataDto {
  range: 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';
  fromMs: number;
  toMs: number;
  summary: {
    subtotal: number;
    discountTotal: number;
    revenue: number;
    customerCount: number;
    invoiceCount: number;
    avgItemsPerInvoice: number;
    avgRevenuePerInvoice: number;
  };
  uncompletedOrders: {
    dineIn: { count: number; amount: number };
    takeaway: { count: number; amount: number };
    total: { count: number; amount: number };
  };
  revenueTimelineChart: DashboardTimelinePoint[];
  paymentTimeChart: DashboardPaymentTimePoint[];
  staffRevenue: DashboardStaffRevenueRow[];
  paymentMethods: {
    byRevenue: DashboardPieSlice[];
    byCount: DashboardPieSlice[];
  };
  orderTypes: {
    byRevenue: DashboardPieSlice[];
    byCount: DashboardPieSlice[];
  };
  categories: {
    byAmount: DashboardPieSlice[];
    byQuantity: DashboardPieSlice[];
  };
  topProducts: {
    byAmount: DashboardTopProductSlice[];
    byQuantity: DashboardTopProductSlice[];
  };
}
