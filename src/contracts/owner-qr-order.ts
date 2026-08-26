import { z } from 'zod';

export const qrSalesHourSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

export const updateOwnerQrOrderSettingsSchema = z
  .object({
    locationVerificationEnabled: z.boolean(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    allowedRadiusMeters: z.number().min(30).max(5000),
    maxAccuracyMeters: z.number().min(20).max(300),
    locationMemoryMinutes: z.number().int().min(5).max(480),
    orderCooldownSeconds: z.number().int().min(1).max(3600),
    callStaffCooldownSeconds: z.number().int().min(1).max(3600),
    checkoutCooldownSeconds: z.number().int().min(1).max(3600),
    salesScheduleEnabled: z.boolean(),
    salesHours: z.array(qrSalesHourSchema).max(28),
  })
  .superRefine((value, ctx) => {
    if (
      value.locationVerificationEnabled &&
      (value.latitude === null || value.longitude === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['latitude'],
        message: 'Vui lòng chọn vị trí cửa hàng khi bật xác minh vị trí.',
      });
    }
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const windows = value.salesHours
        .filter((window) => window.weekday === weekday)
        .toSorted((left, right) => left.startMinute - right.startMinute);
      if (windows.length > 4) {
        ctx.addIssue({
          code: 'custom',
          path: ['salesHours'],
          message: 'Mỗi ngày chỉ được cấu hình tối đa 4 khung giờ.',
        });
      }
      windows.forEach((window, index) => {
        if (window.endMinute <= window.startMinute) {
          ctx.addIssue({
            code: 'custom',
            path: ['salesHours'],
            message: 'Giờ kết thúc phải sau giờ bắt đầu.',
          });
        }
        const previous = windows[index - 1];
        if (previous && previous.endMinute > window.startMinute) {
          ctx.addIssue({
            code: 'custom',
            path: ['salesHours'],
            message: 'Các khung giờ trong cùng một ngày không được chồng lấn.',
          });
        }
      });
    }
  });

export const updateQrSalesStatusSchema = z.object({ paused: z.boolean() });
export const updateTableQrStatusSchema = z.object({ enabled: z.boolean() });
export const updateQrMenuProductSchema = z.object({ enabled: z.boolean() });
export const updateQrMenuVariantSchema = z.object({ enabled: z.boolean() });
export const bulkUpdateTableQrStatusSchema = z.object({
  tableIds: z.array(z.uuid()).min(1).max(200),
  enabled: z.boolean(),
});

export const quickReasonInputSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
});

export const updateQuickReasonsSchema = z
  .object({ reasons: z.array(quickReasonInputSchema).max(20) })
  .superRefine((value, ctx) => {
    const normalized = value.reasons.map((reason) => reason.label.toLocaleLowerCase('vi-VN'));
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'Lý do gọi nhân viên không được trùng nhau.',
      });
    }
  });

export type UpdateOwnerQrOrderSettingsInput = z.infer<typeof updateOwnerQrOrderSettingsSchema>;
export type QuickReasonInput = z.infer<typeof quickReasonInputSchema>;

export interface OwnerQrSalesAvailability {
  acceptingOrders: boolean;
  manuallyPaused: boolean;
  scheduleEnabled: boolean;
  reason: 'OPEN' | 'MANUALLY_PAUSED' | 'OUTSIDE_SCHEDULE';
  nextOpenAt: number | null;
}

export interface OwnerQrOrderSettingsDto {
  timezone: string;
  locationVerificationEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
  locationMemoryMinutes: number;
  orderCooldownSeconds: number;
  callStaffCooldownSeconds: number;
  checkoutCooldownSeconds: number;
  salesScheduleEnabled: boolean;
  salesPaused: boolean;
  salesPausedAt: number | null;
  salesHours: Array<{
    id: string;
    weekday: number;
    startMinute: number;
    endMinute: number;
  }>;
  availability: OwnerQrSalesAvailability;
}

export interface OwnerQrTableDto {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  areaId: string;
  areaName: string;
  qrOrderEnabled: boolean;
  qrExists: boolean;
  qrPath: string | null;
}

export interface QrQuickReasonDto {
  id: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
}
