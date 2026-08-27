import { z } from 'zod';

export const namedResourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
});

export interface SampleUnitGroup {
  category: 'Đồ ăn' | 'Đồ uống' | 'Khác';
  units: readonly string[];
}

export const SAMPLE_UNIT_GROUPS: readonly SampleUnitGroup[] = [
  {
    category: 'Đồ ăn',
    units: [
      'Miligram (mg)',
      'Gram (g)',
      'Kilogram (kg)',
      'Phần',
      'Suất',
      'Viên',
      'Miếng',
      'Cái',
      'Đĩa',
      'Chén',
      'Bát',
      'Tô',
      'Hộp',
      'Khay',
      'Bao',
      'Tá',
    ],
  },
  {
    category: 'Đồ uống',
    units: [
      'Milliliter (ml)',
      'Liter (l)',
      'Ly',
      'Cốc',
      'Tách',
      'Lon',
      'Chai',
      'Bình',
      'Can',
      'Lốc',
      'Pack',
      'Két',
      'Thùng',
    ],
  },
  {
    category: 'Khác',
    units: ['Lần', 'Vé', 'Giờ', 'Buổi', 'Gói'],
  },
] as const;

export const DEFAULT_STORE_UNITS: readonly string[] = SAMPLE_UNIT_GROUPS.flatMap(
  (group) => group.units,
);

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
  timeProductId: z.uuid().optional().nullable(),
  name: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).default(0),
});

export const createBatchServiceTablesSchema = z.object({
  areaId: z.uuid(),
  timeProductId: z.uuid().optional().nullable(),
  tables: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        sortOrder: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const areaTableNameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createAreaLayoutSchema = z.object({
  name: z.string().trim().min(1).max(160),
  tables: z.array(areaTableNameSchema).min(1).max(100),
});

export const updateServiceTableSchema = areaTableNameSchema;

export const updateServiceTableStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'DISABLED']),
});

export const updateServiceTablePricingSchema = z.object({
  timeProductId: z.uuid(),
});

export const reorderServiceTablesSchema = z
  .object({
    tableIds: z.array(z.uuid()).min(1).max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.tableIds).size !== value.tableIds.length) {
      context.addIssue({ code: 'custom', message: 'Danh sách bàn/phòng không được trùng.' });
    }
  });

export const CATALOG_IMPORT_MAX_ROWS = 2_000;
export const CATALOG_IMPORT_MAX_VARIANTS = 20;

export const catalogImportRowSchema = z.object({
  sourceRow: z.number().int().positive(),
  productId: z.string().trim().max(64).nullable(),
  variantId: z.string().trim().max(64).nullable(),
  name: z.string().trim().max(160),
  productType: z.string().trim().max(40),
  categoryName: z.string().trim().max(160).nullable(),
  unitName: z.string().trim().max(160).nullable(),
  variantName: z.string().trim().max(120).nullable(),
  salePrice: z.string().trim().max(40).nullable(),
  costPrice: z.string().trim().max(40).nullable(),
  promptPrice: z.string().trim().max(20).nullable(),
  avatarColor: z.string().trim().max(20).nullable(),
  description: z.string().trim().max(1_000).nullable(),
  timeBasePrice: z.string().trim().max(40).nullable(),
  timeBaseDurationMinutes: z.string().trim().max(40).nullable(),
  timeCalculationMode: z.string().trim().max(40).nullable(),
  timeRoundingUnit: z.string().trim().max(40).nullable(),
  timeFirstPeriodEnabled: z.string().trim().max(20).nullable(),
  timeFirstPeriodDurationMinutes: z.string().trim().max(40).nullable(),
  timeFirstPeriodPrice: z.string().trim().max(40).nullable(),
});

export const catalogImportPreviewSchema = z.object({
  rows: z.array(catalogImportRowSchema).min(1).max(CATALOG_IMPORT_MAX_ROWS),
  autoCreateCategories: z.boolean().default(false),
  autoCreateUnits: z.boolean().default(false),
});

export const catalogImportCommitSchema = catalogImportPreviewSchema.extend({
  normalizedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  skipInvalidGroups: z.boolean().default(false),
});

export const catalogExportSchema = z.object({
  productIds: z.array(z.uuid()).max(CATALOG_IMPORT_MAX_ROWS).optional(),
});

export type CatalogImportRow = z.infer<typeof catalogImportRowSchema>;
export type CatalogImportPreviewInput = z.infer<typeof catalogImportPreviewSchema>;
export type CatalogImportCommitInput = z.infer<typeof catalogImportCommitSchema>;

export type CatalogImportAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

export interface CatalogImportIssue {
  sourceRow: number;
  productGroup: string;
  action: CatalogImportAction;
  errorCode: string | null;
  field: string | null;
  message: string;
  rawValue: string | null;
  suggestion: string | null;
}

export interface CatalogImportSummary {
  totalRows: number;
  totalProducts: number;
  createProducts: number;
  updateProducts: number;
  newVariants: number;
  updateVariants: number;
  skippedProducts: number;
  warningRows: number;
  errorRows: number;
  categoriesToCreate: string[];
  unitsToCreate: string[];
}

export interface CatalogImportPreviewResult {
  normalizedPayloadHash: string;
  summary: CatalogImportSummary;
  issues: CatalogImportIssue[];
}

export interface CatalogImportCommitResult extends CatalogImportPreviewResult {
  createdProducts: number;
  updatedProducts: number;
  skippedProducts: number;
  failedProducts: number;
  createdCategories: number;
  createdUnits: number;
  replayed: boolean;
}
