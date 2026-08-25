import type {
  CatalogImportAction,
  CatalogImportCommitInput,
  CatalogImportCommitResult,
  CatalogImportIssue,
  CatalogImportPreviewInput,
  CatalogImportPreviewResult,
  CatalogImportRow,
  CatalogImportSummary,
} from '@contracts/catalog';
import { CATALOG_IMPORT_MAX_VARIANTS } from '@contracts/catalog';
import { AppError } from '@server/lib/app-error';
import {
  CatalogRepository,
  type CatalogImportNamedRow,
} from '@server/repositories/catalog-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

type ProductType = 'QUANTITY' | 'WEIGHT' | 'TIME';
type CalculationMode = 'ACTUAL_TIME' | 'TIME_BLOCK';

interface ParsedVariant {
  id: string | null;
  displayCode: string | null;
  name: string;
  salePriceVnd: number | null;
  costPriceVnd: number;
  promptPrice: boolean;
}

interface ParsedPricing {
  basePriceVnd: number;
  baseDurationSeconds: number;
  calculationMode: CalculationMode;
  roundingUnitVnd: 0 | 100 | 500 | 1000 | 5000;
  firstPeriod: { enabled: false } | { enabled: true; durationSeconds: number; priceVnd: number };
}

interface ImportGroup {
  key: string;
  rows: CatalogImportRow[];
  sourceRow: number;
  action: CatalogImportAction;
  productId: string | null;
  name: string;
  normalizedName: string;
  productType: ProductType | null;
  categoryName: string | null;
  unitName: string | null;
  description: string | null;
  avatarColor: string | null;
  variants: ParsedVariant[];
  pricing: ParsedPricing | null;
  issues: CatalogImportIssue[];
  fingerprint: string | null;
}

interface ImportPlan {
  groups: ImportGroup[];
  categoriesToCreate: string[];
  unitsToCreate: string[];
  summary: CatalogImportSummary;
  normalizedPayloadHash: string;
}

const productTypeMap: Record<string, ProductType> = {
  'số lượng': 'QUANTITY',
  quantity: 'QUANTITY',
  'trọng lượng': 'WEIGHT',
  weight: 'WEIGHT',
  'thời gian': 'TIME',
  time: 'TIME',
};

const booleanMap: Record<string, boolean> = {
  có: true,
  yes: true,
  true: true,
  '1': true,
  không: false,
  no: false,
  false: false,
  '0': false,
};

const calculationModeMap: Record<string, CalculationMode> = {
  'thời gian thực tế': 'ACTUAL_TIME',
  actual_time: 'ACTUAL_TIME',
  'theo khung thời gian': 'TIME_BLOCK',
  time_block: 'TIME_BLOCK',
};

function normalized(value: string) {
  return value.normalize('NFC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('vi');
}

function clean(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseInteger(value: string | null, field: string, code: string, minimum = 0) {
  const source = clean(value);
  if (!source) return null;
  if (!/^\d+$|^\d{1,3}(?:[.,\s]\d{3})+$/u.test(source)) {
    throw { field, code, rawValue: source, message: 'Giá trị phải là số nguyên không âm.' };
  }
  const parsed = Number(source.replaceAll(/[.,\s]/gu, ''));
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw { field, code, rawValue: source, message: 'Giá trị không hợp lệ.' };
  }
  return parsed;
}

function mapRequired<T>(
  value: string | null,
  map: Record<string, T>,
  field: string,
  code: string,
  message: string,
) {
  const source = clean(value);
  const mapped = source ? map[normalized(source)] : undefined;
  if (mapped === undefined) throw { field, code, rawValue: source, message };
  return mapped;
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function issue(
  group: ImportGroup,
  input: {
    sourceRow?: number;
    action?: CatalogImportAction;
    errorCode: string;
    field: string | null;
    message: string;
    rawValue?: string | null;
    suggestion?: string | null;
  },
) {
  group.issues.push({
    sourceRow: input.sourceRow ?? group.sourceRow,
    productGroup: group.name || group.key,
    action: input.action ?? 'ERROR',
    errorCode: input.errorCode,
    field: input.field,
    message: input.message,
    rawValue: input.rawValue ?? null,
    suggestion: input.suggestion ?? null,
  });
  group.action = 'ERROR';
}

function sameProductFields(rows: CatalogImportRow[]) {
  const first = rows[0]!;
  const keys: Array<keyof CatalogImportRow> = [
    'name',
    'productType',
    'categoryName',
    'unitName',
    'avatarColor',
    'description',
    'timeBasePrice',
    'timeBaseDurationMinutes',
    'timeCalculationMode',
    'timeRoundingUnit',
    'timeFirstPeriodEnabled',
    'timeFirstPeriodDurationMinutes',
    'timeFirstPeriodPrice',
  ];
  return rows.every((row) =>
    keys.every(
      (key) => normalized(String(row[key] ?? '')) === normalized(String(first[key] ?? '')),
    ),
  );
}

export class CatalogImportService {
  private readonly repository: CatalogRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new CatalogRepository(env.DB);
  }

  async preview(
    storeId: string,
    input: CatalogImportPreviewInput,
  ): Promise<CatalogImportPreviewResult> {
    const plan = await this.plan(storeId, input);
    return {
      normalizedPayloadHash: plan.normalizedPayloadHash,
      summary: plan.summary,
      issues: plan.groups.flatMap((group) => group.issues),
    };
  }

  async exportRows(
    storeId: string,
    productIds?: string[],
  ): Promise<Array<Omit<CatalogImportRow, 'sourceRow'>>> {
    const snapshot = await this.repository.loadImportSnapshot(storeId);
    const selected = productIds ? new Set(productIds) : null;
    const variantsByProduct = new Map<string, typeof snapshot.variants>();
    for (const variant of snapshot.variants) {
      variantsByProduct.set(variant.productId, [
        ...(variantsByProduct.get(variant.productId) ?? []),
        variant,
      ]);
    }
    const pricingByProduct = new Map(snapshot.pricing.map((item) => [item.productId, item]));
    const output: Array<Omit<CatalogImportRow, 'sourceRow'>> = [];
    for (const product of snapshot.products) {
      if (selected && !selected.has(product.id)) continue;
      const pricing = pricingByProduct.get(product.id);
      const common = {
        productId: product.id,
        name: product.name,
        productType:
          product.productType === 'QUANTITY'
            ? 'Số lượng'
            : product.productType === 'WEIGHT'
              ? 'Trọng lượng'
              : 'Thời gian',
        categoryName: product.categoryName,
        unitName: product.unitName,
        avatarColor: product.avatarColor,
        description: product.description,
        timeBasePrice: pricing ? String(pricing.basePriceVnd) : null,
        timeBaseDurationMinutes: pricing ? String(pricing.baseDurationSeconds / 60) : null,
        timeCalculationMode: pricing
          ? pricing.calculationMode === 'ACTUAL_TIME'
            ? 'Thời gian thực tế'
            : 'Theo khung thời gian'
          : null,
        timeRoundingUnit: pricing ? String(pricing.roundingUnitVnd) : null,
        timeFirstPeriodEnabled: pricing?.firstPeriodEnabled ? 'Có' : 'Không',
        timeFirstPeriodDurationMinutes:
          pricing?.firstPeriodDurationSeconds === null ||
          pricing?.firstPeriodDurationSeconds === undefined
            ? null
            : String(pricing.firstPeriodDurationSeconds / 60),
        timeFirstPeriodPrice:
          pricing?.firstPeriodPrice === null || pricing?.firstPeriodPrice === undefined
            ? null
            : String(pricing.firstPeriodPrice),
      };
      if (product.productType === 'TIME') {
        output.push({
          ...common,
          variantId: null,
          variantName: null,
          salePrice: null,
          costPrice: null,
          promptPrice: 'Không',
        });
        continue;
      }
      for (const variant of variantsByProduct.get(product.id) ?? []) {
        output.push({
          ...common,
          variantId: variant.id,
          variantName: variant.name,
          salePrice: variant.salePriceVnd === null ? null : String(variant.salePriceVnd),
          costPrice: String(variant.costPriceVnd),
          promptPrice: variant.promptPrice ? 'Có' : 'Không',
        });
      }
    }
    return output;
  }

  async commit(input: {
    storeId: string;
    payload: CatalogImportCommitInput;
    idempotencyKey: string;
    auditContext: AuditContext;
  }): Promise<CatalogImportCommitResult> {
    const replay = await this.repository.findCatalogImportCommand(
      input.storeId,
      input.idempotencyKey,
    );
    if (replay) {
      if (replay.payloadHash !== input.payload.normalizedPayloadHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          'Mã xác nhận đã được dùng cho dữ liệu khác.',
          409,
        );
      }
      return { ...(JSON.parse(replay.resultJson) as CatalogImportCommitResult), replayed: true };
    }

    const plan = await this.plan(input.storeId, input.payload);
    if (plan.normalizedPayloadHash !== input.payload.normalizedPayloadHash) {
      throw new AppError(
        'PREVIEW_STALE',
        'Dữ liệu catalog đã thay đổi. Vui lòng kiểm tra lại.',
        409,
      );
    }
    if (!input.payload.skipInvalidGroups && plan.groups.some((group) => group.action === 'ERROR')) {
      throw new AppError('IMPORT_HAS_ERRORS', 'Hãy sửa các lỗi trước khi nhập dữ liệu.', 422, {
        issues: plan.groups.flatMap((group) => group.issues),
      });
    }

    const snapshot = await this.repository.loadImportSnapshot(input.storeId);
    const categoryIds = new Map(
      snapshot.categories.map((item) => [normalized(item.name), item.id]),
    );
    const unitIds = new Map(snapshot.units.map((item) => [normalized(item.name), item.id]));
    const newCategories: Array<{ id: string; name: string }> = [];
    const newUnits: Array<{ id: string; name: string }> = [];
    for (const name of plan.categoriesToCreate) {
      const key = normalized(name);
      if (categoryIds.has(key)) continue;
      const categoryId = crypto.randomUUID();
      categoryIds.set(key, categoryId);
      newCategories.push({ id: categoryId, name });
    }
    for (const name of plan.unitsToCreate) {
      const key = normalized(name);
      if (unitIds.has(key)) continue;
      const unitId = crypto.randomUUID();
      unitIds.set(key, unitId);
      newUnits.push({ id: unitId, name });
    }
    await this.repository.createCatalogImportNamed({
      storeId: input.storeId,
      categories: newCategories,
      units: newUnits,
      now: Date.now(),
    });
    const createdCategories = newCategories.length;
    const createdUnits = newUnits.length;

    let createdProducts = 0;
    let updatedProducts = 0;
    let skippedProducts = 0;
    let failedProducts = 0;
    const commitIssues: CatalogImportIssue[] = [];
    for (const group of plan.groups) {
      if (group.action === 'SKIP') {
        skippedProducts += 1;
        continue;
      }
      if (group.action === 'ERROR' || !group.productType) {
        failedProducts += 1;
        continue;
      }
      try {
        const productId = group.productId ?? crypto.randomUUID();
        const committed = await this.repository.commitCatalogImportGroup(
          input.storeId,
          {
            action: group.action,
            product: {
              id: productId,
              expectedUpdatedAt: group.fingerprint === null ? null : Number(group.fingerprint),
              categoryId: group.categoryName
                ? (categoryIds.get(normalized(group.categoryName)) ?? null)
                : null,
              unitId: group.unitName ? (unitIds.get(normalized(group.unitName)) ?? null) : null,
              name: group.name,
              description: group.description,
              productType: group.productType,
              avatarColor: group.avatarColor,
            },
            variants: group.variants.map((variant) => ({
              id: variant.id ?? crypto.randomUUID(),
              displayCode:
                variant.displayCode ??
                `MH${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
              name: variant.name,
              salePriceVnd: variant.salePriceVnd,
              costPriceVnd: variant.costPriceVnd,
              promptPrice: variant.promptPrice,
            })),
            pricing: group.pricing,
          },
          Date.now(),
        );
        if (!committed.committed) {
          throw new AppError(
            group.action === 'CREATE' ? 'PRODUCT_NAME_DUPLICATE' : 'CONCURRENT_UPDATE',
            group.action === 'CREATE'
              ? 'Tên mặt hàng vừa được tạo ở nơi khác.'
              : 'Mặt hàng vừa được thay đổi ở nơi khác.',
            409,
          );
        }
        if (group.action === 'CREATE') createdProducts += 1;
        else updatedProducts += 1;
      } catch (error) {
        failedProducts += 1;
        commitIssues.push({
          sourceRow: group.sourceRow,
          productGroup: group.name,
          action: 'ERROR',
          errorCode: error instanceof AppError ? error.code : 'DATABASE_CONFLICT',
          field: null,
          message:
            error instanceof AppError
              ? error.message
              : 'Không thể lưu mặt hàng. Dữ liệu đã được giữ nguyên cho nhóm này.',
          rawValue: null,
          suggestion: 'Kiểm tra lại dữ liệu rồi thử lại.',
        });
      }
    }

    const result: CatalogImportCommitResult = {
      normalizedPayloadHash: plan.normalizedPayloadHash,
      summary: { ...plan.summary, errorRows: plan.summary.errorRows + commitIssues.length },
      issues: [...plan.groups.flatMap((group) => group.issues), ...commitIssues],
      createdProducts,
      updatedProducts,
      skippedProducts,
      failedProducts,
      createdCategories,
      createdUnits,
      replayed: false,
    };
    await this.repository.recordCatalogImportCommand({
      storeId: input.storeId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payload.normalizedPayloadHash,
      resultJson: JSON.stringify(result),
      now: Date.now(),
    });
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: 'CATALOG_IMPORTED',
      entityType: 'CATALOG',
      entityId: null,
      before: null,
      after: {
        createdProducts,
        updatedProducts,
        skippedProducts,
        failedProducts,
        createdCategories,
        createdUnits,
      },
      now: Date.now(),
    });
    return result;
  }

  private async plan(storeId: string, input: CatalogImportPreviewInput): Promise<ImportPlan> {
    const snapshot = await this.repository.loadImportSnapshot(storeId);
    const productsById = new Map(snapshot.products.map((item) => [item.id, item]));
    const productsByName = new Map<string, typeof snapshot.products>();
    for (const product of snapshot.products) {
      const key = normalized(product.name);
      productsByName.set(key, [...(productsByName.get(key) ?? []), product]);
    }
    const variantsById = new Map(snapshot.variants.map((item) => [item.id, item]));
    const categories = this.namedMap(snapshot.categories);
    const units = this.namedMap(snapshot.units);
    const pricingByProduct = new Map(snapshot.pricing.map((item) => [item.productId, item]));
    const groups = new Map<string, ImportGroup>();
    for (const row of input.rows) {
      const productId = clean(row.productId);
      const key = productId ? `id:${productId}` : `name:${normalized(row.name)}`;
      const existing = groups.get(key);
      if (existing) existing.rows.push(row);
      else {
        groups.set(key, {
          key,
          rows: [row],
          sourceRow: row.sourceRow,
          action: 'CREATE',
          productId,
          name: row.name.trim(),
          normalizedName: normalized(row.name),
          productType: null,
          categoryName: clean(row.categoryName),
          unitName: clean(row.unitName),
          description: clean(row.description),
          avatarColor: clean(row.avatarColor),
          variants: [],
          pricing: null,
          issues: [],
          fingerprint: null,
        });
      }
    }

    const categoriesToCreate = new Set<string>();
    const unitsToCreate = new Set<string>();
    for (const group of groups.values()) {
      this.validateGroup(group, productsById, productsByName, variantsById, pricingByProduct);
      if (group.action === 'ERROR' || group.action === 'SKIP') continue;
      this.resolveNamed(
        group,
        categories,
        input.autoCreateCategories,
        'CATEGORY',
        categoriesToCreate,
      );
      this.resolveNamed(group, units, input.autoCreateUnits, 'UNIT', unitsToCreate);
      if (group.productId)
        group.fingerprint = String(productsById.get(group.productId)?.updatedAt ?? '');
    }
    const values = [...groups.values()];
    const summary = this.summary(values, [...categoriesToCreate], [...unitsToCreate]);
    const normalizedPayloadHash = await sha256({
      rows: input.rows,
      autoCreateCategories: input.autoCreateCategories,
      autoCreateUnits: input.autoCreateUnits,
      groups: values.map((group) => ({
        key: group.key,
        action: group.action,
        fingerprint: group.fingerprint,
        issues: group.issues.map((item) => [item.errorCode, item.field, item.sourceRow]),
      })),
    });
    return {
      groups: values,
      categoriesToCreate: [...categoriesToCreate],
      unitsToCreate: [...unitsToCreate],
      summary,
      normalizedPayloadHash,
    };
  }

  private namedMap(rows: CatalogImportNamedRow[]) {
    const map = new Map<string, CatalogImportNamedRow[]>();
    for (const row of rows) {
      const key = normalized(row.name);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }

  private resolveNamed(
    group: ImportGroup,
    values: Map<string, CatalogImportNamedRow[]>,
    autoCreate: boolean,
    kind: 'CATEGORY' | 'UNIT',
    additions: Set<string>,
  ) {
    const name = kind === 'CATEGORY' ? group.categoryName : group.unitName;
    if (!name) return;
    const matches = values.get(normalized(name)) ?? [];
    if (matches.length > 1) {
      issue(group, {
        errorCode: `${kind}_AMBIGUOUS`,
        field: kind === 'CATEGORY' ? 'Danh mục' : 'Đơn vị',
        message: 'Có nhiều dữ liệu cùng tên, không thể tự chọn.',
      });
    } else if (matches.length === 0 && !autoCreate) {
      issue(group, {
        errorCode: `${kind}_NOT_FOUND`,
        field: kind === 'CATEGORY' ? 'Danh mục' : 'Đơn vị',
        message: `Không tìm thấy ${kind === 'CATEGORY' ? 'danh mục' : 'đơn vị'}.`,
        suggestion: 'Bật tự động tạo hoặc sửa lại tên.',
      });
    } else if (matches.length === 0) {
      additions.add(name);
    }
  }

  private validateGroup(
    group: ImportGroup,
    productsById: Map<string, { id: string; name: string; updatedAt: number }>,
    productsByName: Map<string, Array<{ id: string }>>,
    variantsById: Map<string, { productId: string; displayCode: string }>,
    pricingByProduct: Map<string, unknown>,
  ) {
    const first = group.rows[0]!;
    if (!group.name) {
      issue(group, {
        errorCode: 'PRODUCT_NAME_REQUIRED',
        field: 'Tên mặt hàng *',
        message: 'Tên mặt hàng là bắt buộc.',
      });
      return;
    }
    if (group.name.length > 160) {
      issue(group, {
        errorCode: 'PRODUCT_NAME_TOO_LONG',
        field: 'Tên mặt hàng *',
        message: 'Tên mặt hàng tối đa 160 ký tự.',
      });
    }
    if (!sameProductFields(group.rows)) {
      issue(group, {
        errorCode: 'PRODUCT_GROUP_CONFLICT',
        field: null,
        message: 'Các dòng của cùng mặt hàng có dữ liệu cấp mặt hàng không nhất quán.',
      });
      return;
    }
    if (group.productId) {
      if (!isUuid(group.productId)) {
        issue(group, {
          errorCode: 'PRODUCT_ID_INVALID',
          field: 'ID hệ thống (không sửa)',
          message: 'ID hệ thống không hợp lệ.',
        });
        return;
      }
      const product = productsById.get(group.productId);
      if (!product) {
        issue(group, {
          errorCode: 'PRODUCT_NOT_FOUND',
          field: 'ID hệ thống (không sửa)',
          message: 'Không tìm thấy mặt hàng cần cập nhật.',
        });
        return;
      }
      group.action = 'UPDATE';
      const sameName = productsByName.get(group.normalizedName) ?? [];
      if (sameName.some((candidate) => candidate.id !== group.productId)) {
        issue(group, {
          errorCode: 'PRODUCT_NAME_CONFLICT',
          field: 'Tên mặt hàng *',
          message: 'Tên mặt hàng đã được dùng bởi mặt hàng khác.',
        });
      }
    } else if ((productsByName.get(group.normalizedName) ?? []).length > 0) {
      group.action = 'SKIP';
      group.issues.push({
        sourceRow: group.sourceRow,
        productGroup: group.name,
        action: 'SKIP',
        errorCode: null,
        field: 'Tên mặt hàng *',
        message: 'Mặt hàng đã tồn tại.',
        rawValue: group.name,
        suggestion: 'Dùng ID hệ thống để cập nhật.',
      });
      return;
    }
    try {
      group.productType = mapRequired(
        first.productType,
        productTypeMap,
        'Loại mặt hàng *',
        'PRODUCT_TYPE_INVALID',
        'Loại mặt hàng không hợp lệ.',
      );
      if (group.avatarColor && !/^#[0-9A-F]{6}$/iu.test(group.avatarColor))
        throw {
          field: 'Màu đại diện',
          code: 'COLOR_INVALID',
          rawValue: group.avatarColor,
          message: 'Màu phải có dạng #RRGGBB.',
        };
      if ((group.description ?? '').length > 1_000)
        throw {
          field: 'Mô tả',
          code: 'DESCRIPTION_TOO_LONG',
          rawValue: group.description,
          message: 'Mô tả tối đa 1000 ký tự.',
        };
      if (group.productType === 'TIME') {
        for (const row of group.rows) {
          if (
            mapRequired(
              row.promptPrice ?? 'Không',
              booleanMap,
              'Nhập giá khi bán',
              'PROMPT_PRICE_INVALID',
              'Giá trị Có/Không không hợp lệ.',
            )
          ) {
            throw {
              field: 'Nhập giá khi bán',
              code: 'PROMPT_PRICE_INVALID',
              rawValue: row.promptPrice,
              message: 'Mặt hàng TIME không hỗ trợ nhập giá khi bán.',
            };
          }
        }
        group.pricing = this.parsePricing(first);
      } else {
        group.variants = group.rows.map((row) => this.parseVariant(row));
        if (group.variants.length === 0)
          throw {
            field: 'Tên phiên bản',
            code: 'VARIANT_NAME_REQUIRED',
            rawValue: null,
            message: 'Mặt hàng cần ít nhất một phiên bản.',
          };
        if (group.variants.length > CATALOG_IMPORT_MAX_VARIANTS)
          throw {
            field: 'Tên phiên bản',
            code: 'TOO_MANY_VARIANTS',
            rawValue: String(group.variants.length),
            message: `Tối đa ${CATALOG_IMPORT_MAX_VARIANTS} phiên bản.`,
          };
        const names = new Set<string>();
        for (const variant of group.variants) {
          const name = normalized(variant.name);
          if (names.has(name))
            throw {
              field: 'Tên phiên bản',
              code: 'VARIANT_NAME_DUPLICATE',
              rawValue: variant.name,
              message: 'Tên phiên bản bị trùng.',
            };
          names.add(name);
          if (variant.id) {
            if (!isUuid(variant.id) || !variantsById.has(variant.id))
              throw {
                field: 'ID phiên bản (không sửa)',
                code: 'VARIANT_ID_NOT_FOUND',
                rawValue: variant.id,
                message: 'Không tìm thấy phiên bản cần cập nhật.',
              };
            if (group.productId && variantsById.get(variant.id)!.productId !== group.productId)
              throw {
                field: 'ID phiên bản (không sửa)',
                code: 'VARIANT_PRODUCT_MISMATCH',
                rawValue: variant.id,
                message: 'Phiên bản không thuộc mặt hàng này.',
              };
            variant.displayCode = variantsById.get(variant.id)!.displayCode;
          }
        }
      }
    } catch (error) {
      const detail = error as {
        field: string;
        code: string;
        rawValue: string | null;
        message: string;
      };
      issue(group, {
        errorCode: detail.code ?? 'UNKNOWN_IMPORT_ERROR',
        field: detail.field ?? null,
        message: detail.message ?? 'Dữ liệu không hợp lệ.',
        rawValue: detail.rawValue ?? null,
      });
    }
    void pricingByProduct;
  }

  private parseVariant(row: CatalogImportRow): ParsedVariant {
    const name = clean(row.variantName);
    if (!name)
      throw {
        field: 'Tên phiên bản',
        code: 'VARIANT_NAME_REQUIRED',
        rawValue: null,
        message: 'Tên phiên bản là bắt buộc.',
      };
    const promptPrice = mapRequired(
      row.promptPrice ?? 'Không',
      booleanMap,
      'Nhập giá khi bán',
      'PROMPT_PRICE_INVALID',
      'Giá trị Có/Không không hợp lệ.',
    );
    const salePriceVnd = parseInteger(row.salePrice, 'Giá bán (VND)', 'SALE_PRICE_INVALID');
    if (!promptPrice && salePriceVnd === null)
      throw {
        field: 'Giá bán (VND)',
        code: 'SALE_PRICE_REQUIRED',
        rawValue: null,
        message: 'Giá bán là bắt buộc khi không nhập giá lúc bán.',
      };
    const costPriceVnd = parseInteger(row.costPrice, 'Giá vốn (VND)', 'COST_PRICE_INVALID') ?? 0;
    return {
      id: clean(row.variantId),
      displayCode: null,
      name,
      salePriceVnd,
      costPriceVnd,
      promptPrice,
    };
  }

  private parsePricing(row: CatalogImportRow): ParsedPricing {
    const basePriceVnd = parseInteger(
      row.timeBasePrice,
      'Giá cơ bản TIME (VND)',
      'TIME_BASE_PRICE_INVALID',
      1,
    );
    if (basePriceVnd === null)
      throw {
        field: 'Giá cơ bản TIME (VND)',
        code: 'TIME_BASE_PRICE_REQUIRED',
        rawValue: null,
        message: 'TIME cần giá cơ bản.',
      };
    const durationMinutes = parseInteger(
      row.timeBaseDurationMinutes,
      'Thời lượng cơ bản TIME (phút)',
      'TIME_DURATION_INVALID',
      1,
    );
    if (durationMinutes === null)
      throw {
        field: 'Thời lượng cơ bản TIME (phút)',
        code: 'TIME_DURATION_REQUIRED',
        rawValue: null,
        message: 'TIME cần thời lượng cơ bản.',
      };
    const calculationMode = mapRequired(
      row.timeCalculationMode,
      calculationModeMap,
      'Cách tính TIME',
      'TIME_MODE_INVALID',
      'Cách tính TIME không hợp lệ.',
    );
    const rounding =
      parseInteger(row.timeRoundingUnit, 'Làm tròn tiền TIME (VND)', 'TIME_ROUNDING_INVALID') ?? 0;
    if (![0, 100, 500, 1000, 5000].includes(rounding))
      throw {
        field: 'Làm tròn tiền TIME (VND)',
        code: 'TIME_ROUNDING_INVALID',
        rawValue: row.timeRoundingUnit,
        message: 'Mức làm tròn TIME không được hỗ trợ.',
      };
    const enabled = mapRequired(
      row.timeFirstPeriodEnabled ?? 'Không',
      booleanMap,
      'Bật kỳ đầu',
      'TIME_FIRST_PERIOD_INVALID',
      'Giá trị Có/Không không hợp lệ.',
    );
    const firstPeriod = enabled
      ? (() => {
          const duration = parseInteger(
            row.timeFirstPeriodDurationMinutes,
            'Thời lượng kỳ đầu (phút)',
            'TIME_FIRST_PERIOD_INVALID',
            1,
          );
          const price = parseInteger(
            row.timeFirstPeriodPrice,
            'Giá kỳ đầu (VND)',
            'TIME_FIRST_PERIOD_INVALID',
            1,
          );
          if (duration === null || price === null)
            throw {
              field: 'Kỳ đầu TIME',
              code: 'TIME_FIRST_PERIOD_INVALID',
              rawValue: null,
              message: 'Kỳ đầu cần thời lượng và giá.',
            };
          return { enabled: true as const, durationSeconds: duration * 60, priceVnd: price };
        })()
      : { enabled: false as const };
    return {
      basePriceVnd,
      baseDurationSeconds: durationMinutes * 60,
      calculationMode,
      roundingUnitVnd: rounding as 0 | 100 | 500 | 1000 | 5000,
      firstPeriod,
    };
  }

  private summary(
    groups: ImportGroup[],
    categoriesToCreate: string[],
    unitsToCreate: string[],
  ): CatalogImportSummary {
    const issues = groups.flatMap((group) => group.issues);
    return {
      totalRows: groups.reduce((sum, group) => sum + group.rows.length, 0),
      totalProducts: groups.length,
      createProducts: groups.filter((group) => group.action === 'CREATE').length,
      updateProducts: groups.filter((group) => group.action === 'UPDATE').length,
      newVariants:
        groups
          .filter((group) => group.action === 'CREATE')
          .reduce((sum, group) => sum + group.variants.length, 0) +
        groups
          .filter((group) => group.action === 'UPDATE')
          .reduce((sum, group) => sum + group.variants.filter((variant) => !variant.id).length, 0),
      updateVariants: groups
        .filter((group) => group.action === 'UPDATE')
        .reduce((sum, group) => sum + group.variants.filter((variant) => variant.id).length, 0),
      skippedProducts: groups.filter((group) => group.action === 'SKIP').length,
      warningRows: issues.filter((item) => item.action === 'SKIP').length,
      errorRows: issues.filter((item) => item.action === 'ERROR').length,
      categoriesToCreate,
      unitsToCreate,
    };
  }
}
