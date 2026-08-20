import type { z } from 'zod';

import type { createProductSchema, pricingConfigSchema } from '@contracts/catalog';
import { AppError } from '@server/lib/app-error';
import { CatalogRepository } from '@server/repositories/catalog-repository';
import { validatePricingConfig } from '@domain/pricing/validation';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

type ProductInput = z.infer<typeof createProductSchema>;
type PricingInput = z.infer<typeof pricingConfigSchema>;

export class CatalogService {
  private readonly repository: CatalogRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new CatalogRepository(env.DB);
  }

  listNamed(storeId: string, table: 'areas' | 'categories' | 'units') {
    return this.repository.listNamed(storeId, table);
  }

  async createNamed(
    storeId: string,
    table: 'areas' | 'categories' | 'units',
    name: string,
    auditContext?: AuditContext,
  ) {
    const id = crypto.randomUUID();
    await this.repository.createNamed({
      id,
      storeId,
      table,
      name: name.trim(),
      now: Date.now(),
    });
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: `${table.slice(0, -1).toUpperCase()}_CREATED`,
        entityType: table.slice(0, -1).toUpperCase(),
        entityId: id,
        before: null,
        after: { name: name.trim() },
        now: Date.now(),
      });
    }
    return { id };
  }

  async createProduct(storeId: string, input: ProductInput, auditContext?: AuditContext) {
    const references = await this.repository.validateProductReferences(
      storeId,
      input.categoryId ?? null,
      input.unitId ?? null,
    );
    if (!references.categoryValid) {
      throw new AppError('CATEGORY_NOT_FOUND', 'Không tìm thấy danh mục đang hoạt động.', 404);
    }
    if (!references.unitValid) {
      throw new AppError('UNIT_NOT_FOUND', 'Không tìm thấy đơn vị tính.', 404);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.repository.createProduct({
      id,
      storeId,
      categoryId: input.categoryId ?? null,
      unitId: input.unitId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      productType: input.productType,
      variants: input.variants.map((variant) => ({
        id: crypto.randomUUID(),
        displayCode: `MH${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        name: variant.name.trim(),
        salePriceVnd: variant.salePriceVnd,
        costPriceVnd: variant.costPriceVnd,
        promptPrice: variant.promptPrice,
      })),
      now,
    });
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'PRODUCT_CREATED',
        entityType: 'PRODUCT',
        entityId: id,
        before: null,
        after: {
          name: input.name.trim(),
          productType: input.productType,
          categoryId: input.categoryId ?? null,
          unitId: input.unitId ?? null,
          variantCount: input.variants.length,
        },
        now,
      });
    }
    return { id };
  }

  listProducts(storeId: string) {
    return this.repository.listProducts(storeId);
  }

  async upsertPricing(storeId: string, input: PricingInput, auditContext?: AuditContext) {
    const product = await this.repository.findTimeProduct(storeId, input.productId);
    if (!product || product.status !== 'ACTIVE') {
      throw new AppError('TIME_PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng tính giờ.', 404);
    }
    const config = {
      version: 1,
      timezone: this.env.STORE_TIMEZONE,
      basePriceVnd: input.basePriceVnd,
      baseDurationSeconds: input.baseDurationSeconds,
      calculationMode: input.calculationMode,
      roundingUnitVnd: input.roundingUnitVnd,
      firstPeriod: input.firstPeriod,
      specialWindows: input.specialWindows.map((window) => ({
        id: crypto.randomUUID(),
        ...window,
      })),
    };
    try {
      validatePricingConfig(config);
    } catch (error) {
      throw new AppError(
        'PRICING_CONFIG_INVALID',
        error instanceof Error ? error.message : 'Bảng giá không hợp lệ.',
        422,
      );
    }
    const result = await this.repository.upsertPricingConfig({
      configId: crypto.randomUUID(),
      storeId,
      productId: input.productId,
      config,
      now: Date.now(),
    });
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'TIME_PRICING_UPDATED',
        entityType: 'PRODUCT',
        entityId: input.productId,
        before: null,
        after: { configId: result.configId, version: result.version },
        now: Date.now(),
      });
    }
    return result;
  }

  async createTable(input: {
    storeId: string;
    areaId: string;
    timeProductId: string;
    name: string;
    sortOrder: number;
    auditContext?: AuditContext;
  }) {
    const id = crypto.randomUUID();
    const result = await this.repository.createServiceTable({
      id,
      ...input,
      now: Date.now(),
    });
    if ((result.meta.changes ?? 0) !== 1) {
      throw new AppError(
        'TABLE_REFERENCE_INVALID',
        'Khu vực hoặc mặt hàng tính giờ không khả dụng.',
        422,
      );
    }
    if (input.auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId: input.storeId,
        context: input.auditContext,
        action: 'SERVICE_TABLE_CREATED',
        entityType: 'SERVICE_TABLE',
        entityId: id,
        before: null,
        after: {
          areaId: input.areaId,
          timeProductId: input.timeProductId,
          name: input.name.trim(),
          status: 'AVAILABLE',
        },
        now: Date.now(),
      });
    }
    return { id };
  }

  listTables(storeId: string) {
    return this.repository.listServiceTables(storeId);
  }
}
