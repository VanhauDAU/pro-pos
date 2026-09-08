import { z } from 'zod';

export interface StaffNotificationItemDto {
  userId: string;
  username: string;
  displayName: string;
  roleName: string;
  roleCode?: string;
  status: 'ACTIVE' | 'DISABLED';
  hasPushSubscription: boolean;
  activeSessionsCount: number;
  enabled: boolean;
  onlyActiveSessions: boolean;
  notifyOrderPaid: boolean;
  notifyQrOrder: boolean;
  notifyCallStaff: boolean;
  notifyCheckoutRequest: boolean;
  notifyTableOpenRequest: boolean;
  notifyPrintStatus: boolean;
  updatedAt: number | null;
}

export interface StoreNotificationOverviewDto {
  vapidConfigured: boolean;
  totalStaff: number;
  enabledStaffCount: number;
  totalSubscriptions: number;
  items: StaffNotificationItemDto[];
}

export const updateStaffNotificationSchema = z.object({
  enabled: z.boolean().optional(),
  onlyActiveSessions: z.boolean().optional(),
  notifyOrderPaid: z.boolean().optional(),
  notifyQrOrder: z.boolean().optional(),
  notifyCallStaff: z.boolean().optional(),
  notifyCheckoutRequest: z.boolean().optional(),
  notifyTableOpenRequest: z.boolean().optional(),
  notifyPrintStatus: z.boolean().optional(),
});

export type UpdateStaffNotificationInput = z.infer<typeof updateStaffNotificationSchema>;

export const bulkUpdateStaffNotificationSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
  settings: updateStaffNotificationSchema,
});

export type BulkUpdateStaffNotificationInput = z.infer<typeof bulkUpdateStaffNotificationSchema>;

export const testPushNotificationSchema = z.object({
  userId: z.string().optional(),
  tag: z.string().optional(),
  kind: z
    .enum([
      'ORDER_PAID',
      'QR_ORDER',
      'CALL_STAFF',
      'CHECKOUT_REQUEST',
      'TABLE_OPEN_REQUEST',
      'PRINT_COMPLETED',
    ])
    .default('ORDER_PAID'),
});

export type TestPushNotificationInput = z.infer<typeof testPushNotificationSchema>;
