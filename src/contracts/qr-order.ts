import { z } from 'zod';

export const verifyGuestLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100000),
  capturedAt: z.number().int().positive().optional(),
});

export type VerifyGuestLocationInput = z.infer<typeof verifyGuestLocationSchema>;

export const guestOrderItemSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(20),
  note: z.string().trim().max(300).nullable().optional(),
});

export const submitGuestOrderSchema = z.object({
  clientRequestId: z.uuid(),
  items: z.array(guestOrderItemSchema).min(1).max(20),
  note: z.string().trim().max(300).nullable().optional(),
  location: verifyGuestLocationSchema.optional(),
});

export const createServiceRequestSchema = z.object({
  type: z.enum(['CALL_STAFF', 'CHECKOUT_REQUEST']),
  location: verifyGuestLocationSchema.optional(),
});

export const acceptGuestOrderSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
});

export const rejectGuestOrderSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(20).max(512),
    auth: z.string().min(8).max(512),
  }),
});

export interface GuestMenuVariant {
  id: string;
  name: string;
  salePriceVnd: number;
}

export interface GuestMenuProduct {
  id: string;
  name: string;
  productType?: 'QUANTITY' | 'WEIGHT';
  categoryId: string | null;
  categoryName: string | null;
  unitName: string | null;
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  variants: GuestMenuVariant[];
}

export interface GuestActiveOrderItemDto {
  id: string;
  productName: string;
  variantName: string | null;
  unitName: string | null;
  quantityMilli: number;
  unitPriceVnd: number;
  grossLineTotalVnd: number;
  discountAmountVnd: number;
  netLineTotalVnd: number;
  note: string | null;
  productType?: string;
  promotionGift?: {
    promotionId: string;
    promotionName: string;
  } | null;
}

export interface GuestActiveOrderTimeDto {
  status: 'RUNNING' | 'PAUSED' | 'ENDED';
  startedAtMs: number;
  endedAtMs: number | null;
  pausedAtMs: number | null;
  elapsedSeconds: number;
  basePriceVnd: number;
  amountAfterRoundingVnd: number;
}

export interface GuestActiveOrderDto {
  id: string;
  displayCode: string;
  openedAt: number;
  items: GuestActiveOrderItemDto[];
  time: GuestActiveOrderTimeDto | null;
  subtotalVnd: number;
  discountTotalVnd: number;
  totalVnd: number;
  calculatedAt: number;
}

export interface VerifyGuestLocationResponse {
  verified: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
  expiresAt: number;
}

export interface GuestLocationRequirementDto {
  required: boolean;
  configured: boolean;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
  isVerified: boolean;
  verifiedExpiresAt: number | null;
  distanceMeters?: number | null;
}

export interface GuestOrderContext {
  tableStatus: 'OPEN' | 'AVAILABLE' | 'OPEN_REQUESTED';
  storeName: string;
  tableName: string;
  areaName: string;
  table: {
    id: string;
    name: string;
    areaName: string;
  };
  sessionExpiresAt: number | null;
  openRequest: {
    id: string;
    status: 'OPEN';
    createdAt: number;
  } | null;
  locationRequirement: GuestLocationRequirementDto;
  activeOrder?: GuestActiveOrderDto | null;
  menu: GuestMenuProduct[];
}

export interface TableOpenRequestDto {
  id: string;
  status: 'OPEN';
  tableId: string;
  tableName: string;
  areaName: string;
  tableVersion: number;
  createdAt: number;
}

export type GuestOrderStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export interface GuestOrderRequestDto {
  id: string;
  status: GuestOrderStatus;
  tableId: string;
  tableName: string;
  areaName: string;
  orderId: string;
  orderVersion: number;
  createdAt: number;
  note: string | null;
  rejectedReason: string | null;
  items: Array<{
    id: string;
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPriceVnd: number;
    lineTotalVnd: number;
    note: string | null;
  }>;
}

export interface ServiceRequestDto {
  id: string;
  type: 'CALL_STAFF' | 'CHECKOUT_REQUEST';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'COMPLETED' | 'CANCELLED';
  tableId: string;
  tableName: string;
  areaName: string;
  orderId: string;
  createdAt: number;
  acknowledgedAt: number | null;
}

export type StaffNotificationEventType =
  | 'QR_ORDER'
  | 'CALL_STAFF'
  | 'CHECKOUT_REQUEST'
  | 'ORDER_CREATED'
  | 'ITEM_ADDED'
  | 'ITEM_UPDATED'
  | 'ITEM_REMOVED'
  | 'ORDER_SAVED'
  | 'TABLE_TRANSFERRED'
  | 'TIME_PAUSED'
  | 'TIME_RESUMED'
  | 'TIME_UPDATED'
  | 'CHECKOUT_PENDING'
  | 'CHECKOUT'
  | 'ORDER_CANCELLED';
export type StaffNotificationStatus =
  | 'PENDING'
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'INFO';

export interface StaffNotificationAuditDto {
  id: string;
  sourceId: string;
  eventType: StaffNotificationEventType;
  status: StaffNotificationStatus;
  orderId: string;
  tableId: string;
  tableName: string;
  areaName: string;
  summary: string;
  note: string | null;
  itemCount: number;
  totalVnd: number;
  actorName: string | null;
  deviceName: string | null;
  handledAt: number | null;
  createdAt: number;
}

export interface StaffNotificationAuditResponse {
  retentionDays: 3;
  items: StaffNotificationAuditDto[];
}
