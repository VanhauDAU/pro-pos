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
  quantityMilli: z.number().int().positive(),
  expectedOrderVersion: z.number().int().positive(),
  discount: z
    .object({
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});

export const checkoutSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  cashReceivedVnd: z.number().int().nonnegative().nullable().optional(),
});

export const timeActionSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
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
