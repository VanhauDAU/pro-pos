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
      reason: z.string().trim().min(1, 'Vui lòng nhập lý do giảm giá.').max(300),
    })
    .nullable()
    .optional(),
});

export const saveOrderItemSchema = addOrderItemSchema.omit({ expectedOrderVersion: true });

const saveOrderGuestSchema = z.object({
  guestCount: z.number().int().min(1).max(999).default(1),
  customerName: z.string().trim().max(100).nullable().optional(),
  customerPhone: z.string().trim().max(30).nullable().optional(),
  customerId: z.uuid().nullable().optional(),
});

export const openOrderCommandSchema = z
  .object({
    orderType: z.enum(['DINE_IN', 'TAKEAWAY']),
    tableId: z.uuid().optional(),
    expectedTableVersion: z.number().int().positive().optional(),
    items: z.array(saveOrderItemSchema).max(100),
    note: z.string().trim().max(500).nullable().optional(),
    guest: saveOrderGuestSchema.optional(),
    promotionIds: z.array(z.uuid()).max(50).optional(),
  })
  .superRefine((value, context) => {
    if (value.orderType === 'DINE_IN' && !value.tableId) {
      context.addIssue({ code: 'custom', path: ['tableId'], message: 'Thiếu bàn cần mở.' });
    }
    if (value.orderType === 'DINE_IN' && value.expectedTableVersion === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expectedTableVersion'],
        message: 'Thiếu phiên bản bàn.',
      });
    }
    if (value.orderType === 'TAKEAWAY' && value.items.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Đơn mang về cần ít nhất một mặt hàng.',
      });
    }
  });

export const saveExistingOrderCommandSchema = z
  .object({
    expectedOrderVersion: z.number().int().positive(),
    addedItems: z.array(saveOrderItemSchema).max(100).default([]),
    updatedItems: z
      .array(
        z.object({
          itemId: z.uuid(),
          quantityMilli: z.number().int().positive().max(1_000_000_000),
        }),
      )
      .max(100)
      .default([]),
    note: z.string().trim().max(500).nullable().optional(),
    guest: saveOrderGuestSchema.optional(),
    promotionIds: z.array(z.uuid()).max(50).optional(),
  })
  .refine((value) => value.addedItems.length + value.updatedItems.length <= 100, {
    message: 'Mỗi lần lưu tối đa 100 dòng thay đổi.',
    path: ['addedItems'],
  });

export type OpenOrderCommandInput = z.infer<typeof openOrderCommandSchema>;
export type SaveExistingOrderCommandInput = z.infer<typeof saveExistingOrderCommandSchema>;

export const updateOrderItemSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  quantityMilli: z.number().int().positive().max(1_000_000_000),
  variantId: z.string().nullable().optional(),
  discount: z
    .object({
      type: z.enum(['FIXED', 'PERCENT']),
      value: z.number().int().nonnegative(),
      reason: z.string().trim().min(1, 'Vui lòng nhập lý do giảm giá.').max(300),
    })
    .nullable()
    .optional(),
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
  paymentSnapshotId: z.uuid().optional(),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  cashReceivedVnd: z.number().int().nonnegative().nullable().optional(),
  allocations: z
    .array(
      z.object({
        method: z.enum(['CASH', 'BANK_TRANSFER']),
        amountVnd: z.number().int().nonnegative(),
        tenderedVnd: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  debtAmountVnd: z.number().int().nonnegative().default(0),
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

export const stopTimeSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
});

export const resumeCheckoutSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
});

export const updateOrderGuestSchema = z.object({
  expectedOrderVersion: z.number().int().positive(),
  guestCount: z.number().int().positive().min(1).max(999),
  customerName: z.string().trim().max(100).nullable().optional(),
  customerPhone: z.string().trim().max(30).nullable().optional(),
  customerId: z.uuid().nullable().optional(),
});
