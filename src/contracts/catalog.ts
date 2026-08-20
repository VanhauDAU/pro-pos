import { z } from 'zod';

export const namedResourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

const productVariantSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  salePriceVnd: z.number().int().nonnegative().nullable(),
  costPriceVnd: z.number().int().nonnegative().default(0),
  promptPrice: z.boolean().default(false),
});

const productFieldsSchema = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  productType: z.enum(['QUANTITY', 'WEIGHT', 'TIME']),
  categoryId: z.uuid().nullable().optional(),
  unitId: z.uuid().nullable().optional(),
  avatarType: z.enum(['COLOR', 'IMAGE']).default('COLOR'),
  avatarColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  mediaId: z.uuid().nullable().optional(),
  variants: z.array(productVariantSchema).max(20).default([]),
};

function validateProductInput(
  value: z.infer<z.ZodObject<typeof productFieldsSchema>>,
  context: z.RefinementCtx,
) {
  if (value.productType !== 'TIME' && value.variants.length === 0) {
    context.addIssue({ code: 'custom', message: 'Mặt hàng cần ít nhất một phiên bản giá.' });
  }
  for (const variant of value.variants) {
    if (value.productType === 'TIME' && variant.promptPrice) {
      context.addIssue({
        code: 'custom',
        message: 'Nhập giá khi bán chỉ áp dụng cho mặt hàng số lượng hoặc trọng lượng.',
      });
    }
    if (!variant.promptPrice && variant.salePriceVnd === null) {
      context.addIssue({ code: 'custom', message: 'Thiếu giá bán.' });
    }
  }
}

export const createProductSchema = z.object(productFieldsSchema).superRefine(validateProductInput);
export const updateProductSchema = z.object(productFieldsSchema).superRefine(validateProductInput);

export const pricingConfigSchema = z.object({
  productId: z.uuid(),
  basePriceVnd: z.number().int().positive(),
  baseDurationSeconds: z.number().int().positive(),
  calculationMode: z.enum(['ACTUAL_TIME', 'TIME_BLOCK']),
  roundingUnitVnd: z.union([
    z.literal(0),
    z.literal(100),
    z.literal(500),
    z.literal(1000),
    z.literal(5000),
  ]),
  firstPeriod: z.discriminatedUnion('enabled', [
    z.object({ enabled: z.literal(false) }),
    z.object({
      enabled: z.literal(true),
      durationSeconds: z.number().int().positive(),
      priceVnd: z.number().int().positive(),
    }),
  ]),
  specialWindows: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      priceVnd: z.number().int().positive(),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(0).max(1439),
      weekdaysMask: z.number().int().min(1).max(127),
    }),
  ),
});

export const createServiceTableSchema = z.object({
  areaId: z.uuid(),
  timeProductId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).default(0),
});

const areaTableNameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createAreaLayoutSchema = z.object({
  name: z.string().trim().min(1).max(160),
  tables: z.array(areaTableNameSchema).min(1).max(100),
});

export const updateServiceTableSchema = areaTableNameSchema;

export const reorderServiceTablesSchema = z
  .object({
    tableIds: z.array(z.uuid()).min(1).max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.tableIds).size !== value.tableIds.length) {
      context.addIssue({ code: 'custom', message: 'Danh sách bàn/phòng không được trùng.' });
    }
  });
