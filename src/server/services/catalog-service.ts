import type { z } from 'zod';

import type { createProductSchema, pricingConfigSchema } from '@contracts/catalog';
import { AppError } from '@server/lib/app-error';
import { CatalogRepository } from '@server/repositories/catalog-repository';
import { validatePricingConfig } from '@domain/pricing/validation';

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

  async createNamed(storeId: string, table: 'areas' | 'categories' | 'units', name: string) {
    const id = crypto.randomUUID();
    await this.repository.createNamed({
      id,
      storeId,
      table,
      name: name.trim(),
      now: Date.now(),
    });
    return { id };
  }

  async createProduct(storeId: string, input: ProductInput) {
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
      variants: input.variants.map((variant, index) => ({
        id: crypto.randomUUID(),
        displayCode: `MH${now}${String(index + 1).padStart(2, '0')}`,
        name: variant.name.trim(),
        salePriceVnd: variant.salePriceVnd,
        costPriceVnd: variant.costPriceVnd,
        promptPrice: variant.promptPrice,
      })),
      now,
    });
    return { id };
  }

  listProducts(storeId: string) {
    return this.repository.listProducts(storeId);
  }

  async upsertPricing(storeId: string, input: PricingInput) {
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
    return this.repository.upsertPricingConfig({
      configId: crypto.randomUUID(),
      storeId,
      productId: input.productId,
      config,
      now: Date.now(),
    });
  }

  async createTable(input: {
    storeId: string;
    areaId: string;
    timeProductId: string;
    name: string;
    sortOrder: number;
  }) {
    const id = crypto.randomUUID();
    const result = await this.repository.createServiceTable({
      id,
      ...input,
      now: Date.now(),
    });
    return { id, result };
  }

  listTables(storeId: string) {
    return this.repository.listServiceTables(storeId);
  }
}
