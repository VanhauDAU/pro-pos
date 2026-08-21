import { z } from 'zod';

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
});

export const createServiceRequestSchema = z.object({
  type: z.enum(['CALL_STAFF', 'CHECKOUT_REQUEST']),
});

export const acceptGuestOrderSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
});

export const rejectGuestOrderSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export interface GuestMenuVariant {
  id: string;
  name: string;
  salePriceVnd: number;
}

export interface GuestMenuProduct {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitName: string | null;
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  variants: GuestMenuVariant[];
}

export interface GuestOrderContext {
  storeName: string;
  tableName: string;
  areaName: string;
  sessionExpiresAt: number;
  menu: GuestMenuProduct[];
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
  tableName: string;
  areaName: string;
  createdAt: number;
}
