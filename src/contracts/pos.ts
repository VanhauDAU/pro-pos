import { z } from 'zod';

export const openTableSchema = z.object({
  tableId: z.uuid(),
  expectedTableVersion: z.number().int().positive(),
});

export const createTakeawayOrderSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});

export const addOrderItemSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  enteredUnitPriceVnd: z.number().int().nonnegative().optional(),
  quantityMilli: z.number().int().positive().max(1_000_000_000),
  timeStartedAtMs: z.number().int().positive().nullable().optional(),
  timeEndedAtMs: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  expectedOrderVersion: z.number().int().positive(),
  discount: z
    .object({
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});

export const updateOrderItemSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  quantityMilli: z.number().int().positive().max(1_000_000_000),
  timeStartedAtMs: z.number().int().positive().nullable().optional(),
  timeEndedAtMs: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const removeOrderItemSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  reason: z.string().trim().min(1, 'Vui lòng nhập lý do xóa').max(500),
});

export const removeTimeSessionSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  reason: z.string().trim().min(1, 'Vui lòng nhập lý do xóa tiền giờ').max(500),
});

export const updateOrderNoteSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  note: z.string().trim().max(500).nullable(),
});

export const checkoutSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  cashReceivedVnd: z.number().int().nonnegative().nullable().optional(),
});

export const timeActionSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
});

export const updateTimeRangeSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  startedAtMs: z.number().int().positive(),
  endedAtMs: z.number().int().positive().nullable(),
});

export const transferTableSchema = z.object({
  targetTableId: z.uuid(),
  expectedOrderVersion: z.number().int().positive(),
  expectedSourceTableVersion: z.number().int().positive(),
  expectedTargetTableVersion: z.number().int().positive(),
});

export const cancelOrderSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});
