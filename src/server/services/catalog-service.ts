import type { z } from 'zod';

import type {
  createAreaLayoutSchema,
  createProductSchema,
  pricingConfigSchema,
} from '@contracts/catalog';
import { AppError } from '@server/lib/app-error';
import { CatalogRepository } from '@server/repositories/catalog-repository';
import { validatePricingConfig } from '@domain/pricing/validation';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

type ProductInput = z.input<typeof createProductSchema>;
type PricingInput = z.infer<typeof pricingConfigSchema>;
type AreaLayoutInput = z.infer<typeof createAreaLayoutSchema>;

export class CatalogService {
  private readonly repository: CatalogRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new CatalogRepository(env.DB);
  }

  listNamed(storeId: string, table: 'areas' | 'categories' | 'units') {
    return this.repository.listNamed(storeId, table);
  }

  listUnits(storeId: string, input: { page?: number; pageSize?: number; search?: string }) {
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 10));
    const page = Math.max(1, input.page ?? 1);
    return this.repository
      .listUnits(storeId, { page, pageSize, search: input.search ?? '' })
      .then((result) => ({ ...result, page, pageSize }));
  }

  async getUnit(
    storeId: string,
    unitId: string,
    input: { page?: number; pageSize?: number; search?: string } = {},
  ) {
    const unit = await this.repository.findUnit(storeId, unitId);
    if (!unit) throw new AppError('UNIT_NOT_FOUND', 'Không tìm thấy đơn vị.', 404);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 10));
    const page = Math.max(1, input.page ?? 1);
    const products = await this.repository.listUnitProducts(storeId, unitId, {
      page,
      pageSize,
      search: input.search ?? '',
    });
    return { ...unit, products: { ...products, page, pageSize } };
  }

  async updateUnit(storeId: string, unitId: string, name: string, auditContext?: AuditContext) {
    const before = await this.repository.findUnit(storeId, unitId);
    if (!before) throw new AppError('UNIT_NOT_FOUND', 'Không tìm thấy đơn vị.', 404);
    const now = Date.now();
    try {
      await this.repository.updateUnit(storeId, unitId, name.trim(), now);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new AppError('UNIT_NAME_CONFLICT', 'Tên đơn vị đã tồn tại.', 409);
      }
      throw error;
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'UNIT_UPDATED',
        entityType: 'UNIT',
        entityId: unitId,
        before,
        after: { name: name.trim() },
        now,
      });
    }
    return { id: unitId, updated: true };
  }

  async deleteUnit(storeId: string, unitId: string, auditContext?: AuditContext) {
    const before = await this.repository.findUnit(storeId, unitId);
    if (!before) throw new AppError('UNIT_NOT_FOUND', 'Không tìm thấy đơn vị.', 404);
    const usage = await this.repository.countProductsByUnit(storeId, unitId);
    if ((usage?.total ?? 0) > 0) {
      throw new AppError('UNIT_IN_USE', 'Không thể xóa đơn vị đang được mặt hàng sử dụng.', 409);
    }
    await this.repository.deleteUnit(storeId, unitId);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'UNIT_DELETED',
        entityType: 'UNIT',
        entityId: unitId,
        before,
        after: { deleted: true },
        now: Date.now(),
      });
    }
    return { id: unitId, deleted: true };
  }

  async createNamed(
    storeId: string,
    table: 'areas' | 'categories' | 'units',
    name: string,
    auditContext?: AuditContext,
  ) {
    const id = crypto.randomUUID();
    try {
      await this.repository.createNamed({
        id,
        storeId,
        table,
        name: name.trim(),
        now: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new AppError(
          table === 'units' ? 'UNIT_NAME_CONFLICT' : 'NAMED_RESOURCE_CONFLICT',
          table === 'units' ? 'Tên đơn vị đã tồn tại.' : 'Tên đã tồn tại.',
          409,
        );
      }
      throw error;
    }
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

  async updateNamed(
    storeId: string,
    table: 'areas' | 'categories' | 'units',
    id: string,
    name: string,
    auditContext?: AuditContext,
  ) {
    const before = await this.repository.findNamed(storeId, table, id);
    if (!before) {
      throw new AppError('NAMED_RESOURCE_NOT_FOUND', 'Không tìm thấy dữ liệu.', 404);
    }
    const now = Date.now();
    await this.repository.updateNamed({ storeId, table, id, name: name.trim(), now });
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: `${table === 'categories' ? 'CATEGORY' : table === 'areas' ? 'AREA' : 'UNIT'}_UPDATED`,
        entityType: table === 'categories' ? 'CATEGORY' : table === 'areas' ? 'AREA' : 'UNIT',
        entityId: id,
        before,
        after: { name: name.trim() },
        now,
      });
    }
    return { id, updated: true };
  }

  async deleteCategory(storeId: string, id: string, auditContext?: AuditContext) {
    const before = await this.repository.findNamed(storeId, 'categories', id);
    if (!before) throw new AppError('CATEGORY_NOT_FOUND', 'Không tìm thấy danh mục.', 404);
    const count = await this.repository.countActiveProductsByCategory(storeId, id);
    if ((count?.total ?? 0) > 0) {
      throw new AppError(
        'CATEGORY_HAS_PRODUCTS',
        'Không thể xóa danh mục đang có mặt hàng. Hãy chuyển mặt hàng trước.',
        409,
      );
    }
    const now = Date.now();
    await this.repository.disableNamed(storeId, id, now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'CATEGORY_DELETED',
        entityType: 'CATEGORY',
        entityId: id,
        before,
        after: { status: 'DISABLED' },
        now,
      });
    }
    return { id, deleted: true };
  }

  async listAreaLayouts(storeId: string) {
    const result = await this.repository.listAreaLayouts(storeId);
    const layouts = new Map<
      string,
      {
        id: string;
        name: string;
        sortOrder: number;
        tables: Array<{
          id: string;
          name: string;
          status: 'AVAILABLE' | 'OCCUPIED';
          sortOrder: number;
          timeProductId: string | null;
          timeProductName: string | null;
        }>;
      }
    >();
    for (const row of result.results) {
      const layout = layouts.get(row.areaId) ?? {
        id: row.areaId,
        name: row.areaName,
        sortOrder: row.areaSortOrder,
        tables: [],
      };
      if (row.tableId && row.tableName && row.tableStatus && row.tableSortOrder !== null) {
        layout.tables.push({
          id: row.tableId,
          name: row.tableName,
          status: row.tableStatus,
          sortOrder: row.tableSortOrder,
          timeProductId: row.timeProductId,
          timeProductName: row.timeProductName,
        });
      }
      layouts.set(row.areaId, layout);
    }
    return [...layouts.values()];
  }

  async createAreaLayout(storeId: string, input: AreaLayoutInput, auditContext?: AuditContext) {
    const areaId = crypto.randomUUID();
    const now = Date.now();
    const tables = input.tables.map((table, index) => ({
      id: crypto.randomUUID(),
      name: table.name.trim(),
      sortOrder: index,
    }));
    try {
      await this.repository.createAreaLayout({
        areaId,
        storeId,
        name: input.name.trim(),
        tables,
        now,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: areas')) {
        throw new AppError('AREA_NAME_CONFLICT', 'Tên khu vực đã tồn tại.', 409);
      }
      throw error;
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'AREA_LAYOUT_CREATED',
        entityType: 'AREA',
        entityId: areaId,
        before: null,
        after: {
          name: input.name.trim(),
          tables: tables.map(({ id, name }) => ({ id, name })),
        },
        now,
      });
    }
    return { id: areaId, tableIds: tables.map((table) => table.id) };
  }

  async updateTable(storeId: string, tableId: string, name: string, auditContext?: AuditContext) {
    const before = await this.repository.findServiceTable(storeId, tableId);
    if (!before) {
      throw new AppError('SERVICE_TABLE_NOT_FOUND', 'Không tìm thấy bàn/phòng.', 404);
    }
    const now = Date.now();
    await this.repository.updateServiceTableName(storeId, tableId, name.trim(), now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'SERVICE_TABLE_UPDATED',
        entityType: 'SERVICE_TABLE',
        entityId: tableId,
        before: { name: before.name, areaId: before.areaId },
        after: { name: name.trim(), areaId: before.areaId },
        now,
      });
    }
    return { id: tableId, updated: true };
  }

  async updateTableStatus(
    storeId: string,
    tableId: string,
    status: 'AVAILABLE' | 'DISABLED',
    auditContext?: AuditContext,
  ) {
    const before = await this.repository.findServiceTable(storeId, tableId);
    if (!before) {
      throw new AppError('SERVICE_TABLE_NOT_FOUND', 'Không tìm thấy bàn/phòng.', 404);
    }
    if (status === 'DISABLED' && before.status === 'OCCUPIED') {
      throw new AppError('SERVICE_TABLE_OCCUPIED', 'Không thể tạm ngưng bàn đang sử dụng.', 409);
    }
    const now = Date.now();
    await this.repository.updateServiceTableStatus(storeId, tableId, status, now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: status === 'DISABLED' ? 'SERVICE_TABLE_DISABLED' : 'SERVICE_TABLE_RESTORED',
        entityType: 'SERVICE_TABLE',
        entityId: tableId,
        before: { status: before.status },
        after: { status },
        now,
      });
    }
    return { id: tableId, status, updated: true };
  }

  async updateTablePricing(
    storeId: string,
    tableId: string,
    timeProductId: string,
    auditContext?: AuditContext,
  ) {
    const table = await this.repository.findServiceTablePricing(storeId, tableId);
    if (!table || table.status === 'DISABLED') {
      throw new AppError('SERVICE_TABLE_NOT_FOUND', 'Không tìm thấy bàn/phòng.', 404);
    }
    if (table.status === 'OCCUPIED') {
      throw new AppError(
        'SERVICE_TABLE_OCCUPIED',
        'Không thể đổi bảng giá khi bàn đang dùng.',
        409,
      );
    }
    const product = await this.repository.findTimeProduct(storeId, timeProductId);
    if (!product || product.status !== 'ACTIVE') {
      throw new AppError('TIME_PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng tính giờ.', 404);
    }
    if (!(await this.repository.getPricingConfig(storeId, timeProductId))) {
      throw new AppError('TABLE_PRICING_MISSING', 'Mặt hàng tính giờ chưa có bảng giá.', 422);
    }
    const now = Date.now();
    await this.repository.updateServiceTablePricing(storeId, tableId, timeProductId, now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'SERVICE_TABLE_PRICING_UPDATED',
        entityType: 'SERVICE_TABLE',
        entityId: tableId,
        before: { timeProductId: table.timeProductId },
        after: { timeProductId },
        now,
      });
    }
    return { id: tableId, timeProductId, updated: true };
  }

  async deleteTable(storeId: string, tableId: string, auditContext?: AuditContext) {
    const before = await this.repository.findServiceTable(storeId, tableId);
    if (!before) {
      throw new AppError('SERVICE_TABLE_NOT_FOUND', 'Không tìm thấy bàn/phòng.', 404);
    }
    if (before.status === 'OCCUPIED') {
      throw new AppError('SERVICE_TABLE_OCCUPIED', 'Không thể xóa bàn/phòng đang sử dụng.', 409);
    }
    const now = Date.now();
    try {
      await this.repository.deleteServiceTable(storeId, tableId);
    } catch {
      await this.repository.disableServiceTable(storeId, tableId, now);
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'SERVICE_TABLE_DELETED',
        entityType: 'SERVICE_TABLE',
        entityId: tableId,
        before: { name: before.name, areaId: before.areaId, status: before.status },
        after: { status: 'DELETED' },
        now,
      });
    }
    return { id: tableId, deleted: true };
  }

  async reorderTables(
    storeId: string,
    areaId: string,
    tableIds: string[],
    auditContext?: AuditContext,
  ) {
    const current = await this.repository.listActiveServiceTableIds(storeId, areaId);
    const currentIds = current.results.map((table) => table.id);
    const requestedIds = new Set(tableIds);
    if (
      currentIds.length === 0 ||
      currentIds.length !== tableIds.length ||
      currentIds.some((tableId) => !requestedIds.has(tableId))
    ) {
      throw new AppError(
        'TABLE_ORDER_INVALID',
        'Danh sách sắp xếp phải chứa đầy đủ bàn/phòng trong khu vực.',
        422,
      );
    }
    const now = Date.now();
    await this.repository.reorderServiceTables({ storeId, areaId, tableIds, now });
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'SERVICE_TABLES_REORDERED',
        entityType: 'AREA',
        entityId: areaId,
        before: { tableIds: currentIds },
        after: { tableIds },
        now,
      });
    }
    return { areaId, tableIds };
  }

  async deleteAreaLayout(storeId: string, areaId: string, auditContext?: AuditContext) {
    const area = await this.repository.findActiveArea(storeId, areaId);
    if (!area) {
      throw new AppError('AREA_NOT_FOUND', 'Không tìm thấy khu vực.', 404);
    }
    if (area.occupiedTableCount > 0) {
      throw new AppError(
        'AREA_HAS_OCCUPIED_TABLES',
        'Không thể xóa khu vực đang có bàn/phòng được sử dụng.',
        409,
      );
    }
    const tables = await this.repository.listActiveServiceTableIds(storeId, areaId);
    const now = Date.now();
    await this.repository.disableAreaLayout(storeId, areaId, now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'AREA_LAYOUT_DELETED',
        entityType: 'AREA',
        entityId: areaId,
        before: { name: area.name, tableIds: tables.results.map((table) => table.id) },
        after: { status: 'DISABLED' },
        now,
      });
    }
    return { id: areaId, deleted: true };
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
    if (input.mediaId && !(await this.repository.findActiveMedia(storeId, input.mediaId))) {
      throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy ảnh mặt hàng.', 404);
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
      avatarType: input.avatarType ?? 'COLOR',
      avatarColor: input.avatarColor ?? null,
      mediaId: input.mediaId ?? null,
      variants: (input.variants ?? []).map((variant) => ({
        id: crypto.randomUUID(),
        displayCode: `MH${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
        name: variant.name.trim(),
        salePriceVnd: variant.salePriceVnd,
        costPriceVnd: variant.costPriceVnd ?? 0,
        promptPrice: variant.promptPrice ?? false,
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
          variantCount: (input.variants ?? []).length,
        },
        now,
      });
    }
    return { id };
  }

  listProducts(storeId: string) {
    return this.repository.listProducts(storeId);
  }

  async getProduct(storeId: string, productId: string) {
    const product = await this.repository.findProduct(storeId, productId);
    if (!product) throw new AppError('PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng.', 404);
    const variants = await this.repository.listProductVariants(storeId, productId);
    let pricing: unknown = null;
    if (product.productType === 'TIME') {
      const config = await this.repository.getPricingConfig(storeId, productId);
      if (config) {
        const specialWindows = await this.repository.listSpecialPriceWindows(storeId, config.id);
        pricing = {
          basePriceVnd: config.basePriceVnd,
          baseDurationSeconds: config.baseDurationSeconds,
          calculationMode: config.calculationMode,
          roundingUnitVnd: config.roundingUnitVnd,
          firstPeriod:
            config.firstPeriodEnabled === 1
              ? {
                  enabled: true,
                  durationSeconds: config.firstPeriodDurationSeconds,
                  priceVnd: config.firstPeriodPrice,
                }
              : { enabled: false },
          specialWindows: specialWindows.results,
        };
      }
    }
    return { ...product, variants: variants.results, pricing };
  }

  async updateProduct(
    storeId: string,
    productId: string,
    input: ProductInput,
    auditContext?: AuditContext,
  ) {
    const before = await this.repository.findProduct(storeId, productId);
    if (!before) throw new AppError('PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng.', 404);
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
    if (input.mediaId && !(await this.repository.findActiveMedia(storeId, input.mediaId))) {
      throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy ảnh mặt hàng.', 404);
    }
    const existingVariants = await this.repository.listProductVariants(storeId, productId);
    const variantById = new Map(existingVariants.results.map((variant) => [variant.id, variant]));
    const now = Date.now();
    await this.repository.updateProduct({
      id: productId,
      storeId,
      categoryId: input.categoryId ?? null,
      unitId: input.unitId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      productType: input.productType,
      avatarType: input.avatarType ?? 'COLOR',
      avatarColor: input.avatarColor ?? null,
      mediaId: input.mediaId ?? null,
      variants: (input.variants ?? []).map((variant) => {
        const displayCode = variant.id
          ? String(variantById.get(variant.id)?.displayCode ?? '')
          : `MH${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
        const item: {
          id?: string;
          displayCode: string;
          name: string;
          salePriceVnd: number | null;
          costPriceVnd: number;
          promptPrice: boolean;
        } = {
          displayCode,
          name: variant.name.trim(),
          salePriceVnd: variant.salePriceVnd,
          costPriceVnd: variant.costPriceVnd ?? 0,
          promptPrice: variant.promptPrice ?? false,
        };
        if (variant.id) item.id = variant.id;
        return item;
      }),
      now,
    });
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'PRODUCT_UPDATED',
        entityType: 'PRODUCT',
        entityId: productId,
        before,
        after: { name: input.name.trim(), productType: input.productType },
        now,
      });
    }
    return { id: productId, updated: true };
  }

  async deleteProduct(storeId: string, productId: string, auditContext?: AuditContext) {
    const before = await this.repository.findProduct(storeId, productId);
    if (!before) throw new AppError('PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng.', 404);
    const now = Date.now();
    await this.repository.disableProduct(storeId, productId, now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'PRODUCT_DISABLED',
        entityType: 'PRODUCT',
        entityId: productId,
        before,
        after: { status: 'DISABLED' },
        now,
      });
    }
    return { id: productId, deleted: true };
  }

  async restoreProduct(storeId: string, productId: string, auditContext?: AuditContext) {
    const before = await this.repository.findProduct(storeId, productId);
    if (!before) throw new AppError('PRODUCT_NOT_FOUND', 'Không tìm thấy mặt hàng.', 404);
    const now = Date.now();
    await this.repository.restoreProduct(storeId, productId, now);
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'PRODUCT_RESTORED',
        entityType: 'PRODUCT',
        entityId: productId,
        before,
        after: { status: 'ACTIVE' },
        now,
      });
    }
    return { id: productId, restored: true };
  }

  listCategoryProducts(storeId: string, categoryId: string, search?: string) {
    return this.repository.listCategoryProducts(storeId, categoryId, search?.trim() ?? '');
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
    timeProductId?: string | null | undefined;
    name: string;
    sortOrder?: number | undefined;
    auditContext?: AuditContext | undefined;
  }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const sortOrder = input.sortOrder ?? 0;
    const timeProductId = input.timeProductId || `area-layout-product:${input.storeId}`;

    if (timeProductId === `area-layout-product:${input.storeId}`) {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO products (
          id, store_id, name, product_type, status, is_system, created_at, updated_at
        ) VALUES (?, ?, 'Cấu hình bàn/phòng', 'TIME', 'ACTIVE', 1, ?, ?)`,
      )
        .bind(timeProductId, input.storeId, now, now)
        .run();
    }

    const result = await this.repository.createServiceTable({
      id,
      storeId: input.storeId,
      areaId: input.areaId,
      timeProductId,
      name: input.name.trim(),
      sortOrder,
      now,
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
          timeProductId,
          name: input.name.trim(),
          status: 'AVAILABLE',
        },
        now,
      });
    }
    return { id, name: input.name.trim() };
  }

  listTables(storeId: string) {
    return this.repository.listServiceTables(storeId);
  }
}
