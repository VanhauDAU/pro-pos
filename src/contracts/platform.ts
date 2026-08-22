import { createEmployeeSchema } from './staff';
import { z } from 'zod';

export const bootstrapSuperAdminSchema = z.object({
  username: z.string().trim().min(3).max(128).optional(),
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(128),
  password: z.string().min(6).max(128).optional(),
});

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ownerDisplayName: z.string().trim().min(1).max(128),
  ownerEmail: z.string().trim().email().max(254),
  ownerUsername: z.string().trim().min(3).max(128).optional(),
  ownerPassword: z.string().min(6).max(128).optional(),
});

export const setStoreCapabilitySchema = z.object({
  capability: z.literal('POS_REALTIME'),
  enabled: z.boolean(),
});

export const updateStoreMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(128).optional(),
  username: z.string().trim().min(3).max(128).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  newPassword: z.string().min(6).max(128).optional(),
});

export { createEmployeeSchema };

export interface PlatformStoreSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'LOCKED';
  timezone: string;
  createdAt: number;
  updatedAt: number;
  posRealtimeEnabled: boolean;
}

export interface CreatePlatformStoreResponse {
  storeId: string;
  ownerUserId: string;
}

export interface PlatformStoreDetail {
  store: {
    id: string;
    name: string;
    status: 'ACTIVE' | 'LOCKED';
    timezone: string;
    createdAt: number;
    updatedAt: number;
    posRealtimeEnabled: boolean;
    settings: {
      currency: string;
      businessDayCutoffMinutes: number;
      phone: string | null;
      address: string | null;
      provinceCode: number | null;
      provinceName: string | null;
      wardCode: number | null;
      wardName: string | null;
      bankName: string | null;
      bankAccountNumber: string | null;
      bankAccountName: string | null;
      bankQrMediaId: string | null;
    } | null;
  };
  members: Array<{
    id: string;
    userId: string;
    username: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    userStatus: 'ACTIVE' | 'DISABLED';
    membershipStatus: 'ACTIVE' | 'DISABLED';
    roleCode: string;
    roleName: string;
    isSystemRole: boolean;
    createdAt: number;
  }>;
  devices: Array<{
    id: string;
    name: string;
    status: 'ACTIVE' | 'REVOKED';
    activatedBy: string;
    activatedByName: string;
    activatedAt: number;
    revokedAt: number | null;
    lastSeenAt: number | null;
    createdAt: number;
  }>;
  sessions: Array<{
    id: string;
    userId: string;
    userName: string;
    userUsername: string;
    userRoleCode?: string | null;
    userRoleName?: string | null;
    deviceId: string | null;
    deviceName: string | null;
    deviceStatus?: 'ACTIVE' | 'REVOKED' | null;
    sessionKind: 'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE';
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    idleExpiresAt: number;
    revokedAt?: number | null;
  }>;
  stats: {
    totalAreas: number;
    totalTables: number;
    openTables: number;
    totalProducts: number;
    totalOrders: number;
    openOrders: number;
    paidOrders: number;
    totalInvoices: number;
    totalRevenue: number;
  };
}

export interface PlatformAnalytics {
  summary: {
    totalStores: number;
    activeStores: number;
    lockedStores: number;
    totalRevenue: number;
    todayRevenue: number;
    last7DaysRevenue: number;
    last30DaysRevenue: number;
    totalInvoices: number;
    totalOrders: number;
    openOrders: number;
    paidOrders: number;
    totalTables: number;
    occupiedTables: number;
    totalActiveDevices: number;
    totalMembers: number;
    avgOrderValue: number;
  };
  revenueTrend: Array<{
    date: string;
    dateLabel: string;
    revenue: number;
    invoiceCount: number;
    orderCount: number;
  }>;
  storePerformance: Array<{
    storeId: string;
    storeName: string;
    status: 'ACTIVE' | 'LOCKED';
    createdAt: number;
    totalRevenue: number;
    todayRevenue: number;
    totalInvoices: number;
    totalOrders: number;
    activeDevices: number;
    activeMembers: number;
    totalTables: number;
    occupiedTables: number;
    avgOrderValue: number;
    lastActivityAt: number | null;
  }>;
  paymentMethods: Array<{
    method: string;
    label: string;
    count: number;
    totalAmount: number;
    percentage: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    label: string;
    orderCount: number;
    revenue: number;
  }>;
  topProducts: Array<{
    name: string;
    productType: string;
    totalQuantity: number;
    totalRevenue: number;
  }>;
}
