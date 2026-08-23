import { z } from 'zod';

export const promotionTypeSchema = z.enum(['FIXED_AMOUNT', 'PERCENT', 'FLAT_PRICE', 'GIFT']);
export const promotionScopeSchema = z.enum(['INVOICE', 'CATEGORY', 'PRODUCT']);

const timeRangeSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
  })
  .refine((value) => value.startMinute !== value.endMinute, 'Khung giờ không hợp lệ.');

const productTargetSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().default(null),
  quantity: z.number().int().positive().max(999).default(1),
});

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Vui lòng nhập tên khuyến mại.').max(160),
    type: promotionTypeSchema,
    value: z.number().int().nonnegative().nullable().default(null),
    minimumOrderVnd: z.number().int().nonnegative().default(0),
    maximumDiscountVnd: z.number().int().positive().nullable().default(null),
    autoApply: z.boolean().default(false),
    startsAt: z.number().int().positive(),
    endsAt: z.number().int().positive().nullable().default(null),
    weekdaysMask: z.number().int().min(1).max(127).nullable().default(null),
    timeRanges: z.array(timeRangeSchema).max(10).default([]),
    scope: promotionScopeSchema,
    categoryIds: z.array(z.uuid()).max(50).default([]),
    productIds: z.array(z.uuid()).max(50).default([]),
    productTargets: z.array(productTargetSchema).max(50).default([]),
    customerGroupIds: z.array(z.uuid()).max(50).default([]),
    giftProductIds: z.array(z.uuid()).max(50).default([]),
    giftTargets: z.array(productTargetSchema).max(50).default([]),
    giftBuyAny: z.boolean().default(false),
    maximumGiftQuantity: z.number().int().positive().max(999).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.endsAt !== null && value.endsAt <= value.startsAt) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
      });
    }
    if (value.type !== 'GIFT' && (value.value === null || value.value <= 0)) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Giá trị khuyến mại phải lớn hơn 0.',
      });
    }
    if (value.type === 'PERCENT' && (value.value ?? 0) > 100) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Phần trăm giảm không vượt quá 100%.',
      });
    }
    if (value.type === 'FLAT_PRICE' && value.scope === 'INVOICE') {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Đồng giá chỉ áp dụng cho danh mục hoặc mặt hàng.',
      });
    }
    if (value.type === 'GIFT' && value.scope === 'CATEGORY') {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Tặng món không áp dụng theo danh mục.',
      });
    }
    if (value.scope === 'CATEGORY' && value.categoryIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['categoryIds'],
        message: 'Vui lòng chọn ít nhất một danh mục.',
      });
    }
    if (
      value.scope === 'PRODUCT' &&
      value.productIds.length === 0 &&
      value.productTargets.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['productIds'],
        message: 'Vui lòng chọn ít nhất một mặt hàng.',
      });
    }
    if (
      value.type === 'GIFT' &&
      value.giftProductIds.length === 0 &&
      value.giftTargets.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['giftProductIds'],
        message: 'Vui lòng chọn mặt hàng được tặng.',
      });
    }
  });

export const promotionStatusSchema = z.object({ active: z.boolean() });
export const applyPromotionSchema = z.object({
  promotionIds: z.array(z.uuid()).max(50).default([]),
  expectedOrderVersion: z.number().int().positive(),
});

export type PromotionInput = z.infer<typeof promotionInputSchema>;
export type PromotionType = z.infer<typeof promotionTypeSchema>;
export type PromotionScope = z.infer<typeof promotionScopeSchema>;

export interface PromotionSummary {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  value: number | null;
  startsAt: number;
  endsAt: number | null;
  status: 'ACTIVE' | 'PAUSED';
  autoApply: boolean;
  computedStatus: 'UPCOMING' | 'ACTIVE' | 'ENDED' | 'PAUSED';
}

export interface PromotionDetail extends PromotionSummary {
  minimumOrderVnd: number;
  maximumDiscountVnd: number | null;
  weekdaysMask: number | null;
  timeRanges: Array<{ startMinute: number; endMinute: number }>;
  categoryIds: string[];
  productIds: string[];
  productTargets: Array<{ productId: string; variantId: string | null; quantity: number }>;
  customerGroupIds: string[];
  giftProductIds: string[];
  giftTargets: Array<{ productId: string; variantId: string | null; quantity: number }>;
  giftBuyAny: boolean;
  maximumGiftQuantity: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PosPromotionGiftItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string | null;
  unitName: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  grossAmountVnd: number;
}

export interface PosPromotionFlatPriceItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantityMilli: number;
  originalUnitPriceVnd: number;
  flatUnitPriceVnd: number;
  discountAmountVnd: number;
}

export interface PosPromotionConfiguredTarget {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  requiredQuantity: number;
}

export interface PosPromotionOption {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  value: number | null;
  minimumOrderVnd: number;
  maximumDiscountVnd: number | null;
  eligible: boolean;
  reason: string | null;
  discountAmountVnd: number;
  selected: boolean;
  autoApply: boolean;
  giftProductNames: string[];
  giftItems: PosPromotionGiftItem[];
  flatPriceItems: PosPromotionFlatPriceItem[];
  categoryNames: string[];
  configuredProductTargets: PosPromotionConfiguredTarget[];
  giftBuyAny: boolean;
  maximumGiftQuantity: number | null;
}

export const promotionPreviewItemSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullable().optional(),
  productType: z.enum(['QUANTITY', 'WEIGHT', 'TIME', 'SERVICE']).optional(),
  productName: z.string().optional(),
  variantName: z.string().nullable().optional(),
  unitPriceVnd: z.number().nonnegative(),
  quantityMilli: z.number().positive(),
  grossLineTotalVnd: z.number().nonnegative(),
  netLineTotalVnd: z.number().nonnegative(),
});

export const promotionPreviewSchema = z.object({
  orderId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  subtotalVnd: z.number().nonnegative(),
  promotionIds: z.array(z.string()).optional(),
  items: z.array(promotionPreviewItemSchema).default([]),
});

export type PromotionPreviewInput = z.infer<typeof promotionPreviewSchema>;

export interface PromotionPreviewResult {
  options: PosPromotionOption[];
  applied: PosPromotionOption[];
  promotionDiscountVnd: number;
  giftItems: Array<{
    productId: string;
    variantId: string;
    productName: string;
    variantName: string | null;
    unitName: string | null;
    unitPriceVnd: number;
    quantityMilli: number;
    grossAmountVnd: number;
    promotionId: string;
    promotionName: string;
  }>;
}
