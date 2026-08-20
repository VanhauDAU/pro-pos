import type { PricingConfigSnapshot } from '@domain/pricing/types';

type NamedTable = 'areas' | 'categories' | 'units';

const namedSelects: Record<NamedTable, string> = {
  areas:
    'SELECT id, name, sort_order AS sortOrder, status FROM areas WHERE store_id = ? ORDER BY sort_order, name COLLATE NOCASE',
  categories:
    'SELECT id, name, sort_order AS sortOrder, status FROM categories WHERE store_id = ? ORDER BY sort_order, name COLLATE NOCASE',
  units: 'SELECT id, name FROM units WHERE store_id = ? ORDER BY name COLLATE NOCASE',
};

export interface TimeProductRow {
  id: string;
  product_type: 'TIME';
  status: 'ACTIVE' | 'DISABLED';
}

export interface AreaLayoutRow {
  areaId: string;
  areaName: string;
  areaSortOrder: number;
  tableId: string | null;
  tableName: string | null;
  tableStatus: 'AVAILABLE' | 'OCCUPIED' | null;
  tableSortOrder: number | null;
}

export interface ServiceTableSummaryRow {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  areaId: string;
}

export interface AreaSummaryRow {
  id: string;
  name: string;
  occupiedTableCount: number;
}

export class CatalogRepository {
  constructor(private readonly db: D1Database) {}

  async listNamed(storeId: string, table: NamedTable) {
    return this.db.prepare(namedSelects[table]).bind(storeId).all();
  }

  async createNamed(input: {
    id: string;
    storeId: string;
    table: NamedTable;
    name: string;
    now: number;
  }) {
    if (input.table === 'units') {
      await this.db
        .prepare(
          'INSERT INTO units (id, store_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(input.id, input.storeId, input.name, input.now, input.now)
        .run();
      return;
    }
    await this.db
      .prepare(
        `INSERT INTO ${input.table} (
          id, store_id, name, sort_order, status, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 'ACTIVE', ?, ?)`,
      )
      .bind(input.id, input.storeId, input.name, input.now, input.now)
      .run();
  }

  listAreaLayouts(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          a.id AS areaId, a.name AS areaName, a.sort_order AS areaSortOrder,
          st.id AS tableId, COALESCE(st.display_name, st.name) AS tableName,
          st.status AS tableStatus,
          st.sort_order AS tableSortOrder
        FROM areas a
        LEFT JOIN service_tables st
          ON st.area_id = a.id AND st.store_id = a.store_id AND st.status != 'DISABLED'
        WHERE a.store_id = ? AND a.status = 'ACTIVE'
        ORDER BY a.sort_order, a.name COLLATE NOCASE, st.sort_order, st.created_at, st.id`,
      )
      .bind(storeId)
      .all<AreaLayoutRow>();
  }

  createAreaLayout(input: {
    areaId: string;
    storeId: string;
    name: string;
    tables: Array<{ id: string; name: string; sortOrder: number }>;
    now: number;
  }) {
    const systemProductId = `area-layout-product:${input.storeId}`;
    return this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO products (
            id, store_id, name, product_type, status, is_system, created_at, updated_at
          ) VALUES (?, ?, 'Cấu hình bàn/phòng', 'TIME', 'ACTIVE', 1, ?, ?)`,
        )
        .bind(systemProductId, input.storeId, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO areas (
            id, store_id, name, sort_order, status, created_at, updated_at
          ) VALUES (?, ?, ?, 0, 'ACTIVE', ?, ?)`,
        )
        .bind(input.areaId, input.storeId, input.name, input.now, input.now),
      ...input.tables.map((table) =>
        this.db
          .prepare(
            `INSERT INTO service_tables (
              id, store_id, area_id, time_product_id, name, display_name, sort_order,
              status, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', 1, ?, ?)`,
          )
          .bind(
            table.id,
            input.storeId,
            input.areaId,
            systemProductId,
            table.id,
            table.name,
            table.sortOrder,
            input.now,
            input.now,
          ),
      ),
    ]);
  }

  findServiceTable(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT id, COALESCE(display_name, name) AS name, status, area_id AS areaId
         FROM service_tables WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(tableId, storeId)
      .first<ServiceTableSummaryRow>();
  }

  updateServiceTableName(storeId: string, tableId: string, name: string, now: number) {
    return this.db
      .prepare(
        `UPDATE service_tables
         SET display_name = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND store_id = ? AND status != 'DISABLED'`,
      )
      .bind(name, now, tableId, storeId)
      .run();
  }

  disableServiceTable(storeId: string, tableId: string, now: number) {
    return this.db
      .prepare(
        `UPDATE service_tables
         SET status = 'DISABLED', version = version + 1, updated_at = ?
         WHERE id = ? AND store_id = ? AND status = 'AVAILABLE'`,
      )
      .bind(now, tableId, storeId)
      .run();
  }

  listActiveServiceTableIds(storeId: string, areaId: string) {
    return this.db
      .prepare(
        `SELECT id FROM service_tables
         WHERE store_id = ? AND area_id = ? AND status != 'DISABLED'
         ORDER BY sort_order, created_at, id`,
      )
      .bind(storeId, areaId)
      .all<{ id: string }>();
  }

  reorderServiceTables(input: {
    storeId: string;
    areaId: string;
    tableIds: string[];
    now: number;
  }) {
    return this.db.batch(
      input.tableIds.map((tableId, sortOrder) =>
        this.db
          .prepare(
            `UPDATE service_tables
             SET sort_order = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND store_id = ? AND area_id = ? AND status != 'DISABLED'`,
          )
          .bind(sortOrder, input.now, tableId, input.storeId, input.areaId),
      ),
    );
  }

  findActiveArea(storeId: string, areaId: string) {
    return this.db
      .prepare(
        `SELECT
          a.id, a.name,
          SUM(CASE WHEN st.status = 'OCCUPIED' THEN 1 ELSE 0 END) AS occupiedTableCount
         FROM areas a
         LEFT JOIN service_tables st ON st.area_id = a.id AND st.store_id = a.store_id
         WHERE a.id = ? AND a.store_id = ? AND a.status = 'ACTIVE'
         GROUP BY a.id
         LIMIT 1`,
      )
      .bind(areaId, storeId)
      .first<AreaSummaryRow>();
  }

  disableAreaLayout(storeId: string, areaId: string, now: number) {
    return this.db.batch([
      this.db
        .prepare(
          `UPDATE service_tables
           SET status = 'DISABLED', version = version + 1, updated_at = ?
           WHERE store_id = ? AND area_id = ? AND status = 'AVAILABLE'`,
        )
        .bind(now, storeId, areaId),
      this.db
        .prepare(
          `UPDATE areas SET status = 'DISABLED', updated_at = ?
           WHERE id = ? AND store_id = ? AND status = 'ACTIVE'`,
        )
        .bind(now, areaId, storeId),
    ]);
  }

  async createProduct(input: {
    id: string;
    storeId: string;
    categoryId: string | null;
    unitId: string | null;
    name: string;
    description: string | null;
    productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
    variants: Array<{
      id: string;
      displayCode: string;
      name: string;
      salePriceVnd: number | null;
      costPriceVnd: number;
      promptPrice: boolean;
    }>;
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO products (
            id, store_id, category_id, unit_id, name, description,
            product_type, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(
          input.id,
          input.storeId,
          input.categoryId,
          input.unitId,
          input.name,
          input.description,
          input.productType,
          input.now,
          input.now,
        ),
      ...input.variants.map((variant) =>
        this.db
          .prepare(
            `INSERT INTO product_variants (
              id, store_id, product_id, display_code, name, sale_price,
              cost_price, prompt_price, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
          )
          .bind(
            variant.id,
            input.storeId,
            input.id,
            variant.displayCode,
            variant.name,
            variant.salePriceVnd,
            variant.costPriceVnd,
            variant.promptPrice ? 1 : 0,
            input.now,
            input.now,
          ),
      ),
    ]);
  }

  async validateProductReferences(
    storeId: string,
    categoryId: string | null,
    unitId: string | null,
  ) {
    const [category, unit] = await this.db.batch([
      this.db
        .prepare(
          `SELECT 1 AS valid FROM categories
           WHERE id = ? AND store_id = ? AND status = 'ACTIVE' LIMIT 1`,
        )
        .bind(categoryId, storeId),
      this.db
        .prepare('SELECT 1 AS valid FROM units WHERE id = ? AND store_id = ? LIMIT 1')
        .bind(unitId, storeId),
    ]);
    return {
      categoryValid: categoryId === null || category?.results.length === 1,
      unitValid: unitId === null || unit?.results.length === 1,
    };
  }

  async listProducts(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          p.id, p.name, p.description, p.product_type AS productType,
          p.status, p.category_id AS categoryId, c.name AS categoryName,
          p.unit_id AS unitId, u.name AS unitName,
          COUNT(pv.id) AS variantCount
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
        LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.status = 'ACTIVE'
        WHERE p.store_id = ? AND p.is_system = 0
        GROUP BY p.id
        ORDER BY p.name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all();
  }

  findTimeProduct(storeId: string, productId: string) {
    return this.db
      .prepare(
        `SELECT id, product_type, status FROM products
         WHERE id = ? AND store_id = ? AND product_type = 'TIME' LIMIT 1`,
      )
      .bind(productId, storeId)
      .first<TimeProductRow>();
  }

  async upsertPricingConfig(input: {
    configId: string;
    storeId: string;
    productId: string;
    config: PricingConfigSnapshot;
    now: number;
  }) {
    const existing = await this.db
      .prepare('SELECT id, version FROM time_price_configs WHERE store_id = ? AND product_id = ?')
      .bind(input.storeId, input.productId)
      .first<{ id: string; version: number }>();
    const configId = existing?.id ?? input.configId;
    const nextVersion = (existing?.version ?? 0) + 1;
    const first = input.config.firstPeriod;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO time_price_configs (
            id, store_id, product_id, base_price, base_duration_seconds,
            calculation_mode, rounding_unit, first_period_enabled,
            first_period_duration_seconds, first_period_price, version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(store_id, product_id) DO UPDATE SET
            base_price = excluded.base_price,
            base_duration_seconds = excluded.base_duration_seconds,
            calculation_mode = excluded.calculation_mode,
            rounding_unit = excluded.rounding_unit,
            first_period_enabled = excluded.first_period_enabled,
            first_period_duration_seconds = excluded.first_period_duration_seconds,
            first_period_price = excluded.first_period_price,
            version = excluded.version,
            updated_at = excluded.updated_at`,
        )
        .bind(
          configId,
          input.storeId,
          input.productId,
          input.config.basePriceVnd,
          input.config.baseDurationSeconds,
          input.config.calculationMode,
          input.config.roundingUnitVnd,
          first.enabled ? 1 : 0,
          first.enabled ? first.durationSeconds : null,
          first.enabled ? first.priceVnd : null,
          nextVersion,
          input.now,
          input.now,
        ),
      this.db
        .prepare('DELETE FROM special_price_windows WHERE time_price_config_id = ?')
        .bind(configId),
      ...input.config.specialWindows.map((window) =>
        this.db
          .prepare(
            `INSERT INTO special_price_windows (
              id, store_id, time_price_config_id, name, price, start_minute,
              end_minute, weekdays_mask, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            window.id,
            input.storeId,
            configId,
            window.name,
            window.priceVnd,
            window.startMinute,
            window.endMinute,
            window.weekdaysMask,
            input.now,
            input.now,
          ),
      ),
    ]);
    return { configId, version: nextVersion };
  }

  async createServiceTable(input: {
    id: string;
    storeId: string;
    areaId: string;
    timeProductId: string;
    name: string;
    sortOrder: number;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO service_tables (
          id, store_id, area_id, time_product_id, name, sort_order,
          status, version, created_at, updated_at
        )
        SELECT ?, ?, a.id, p.id, ?, ?, 'AVAILABLE', 1, ?, ?
        FROM areas a, products p
        WHERE a.id = ? AND a.store_id = ? AND a.status = 'ACTIVE'
          AND p.id = ? AND p.store_id = ? AND p.product_type = 'TIME' AND p.status = 'ACTIVE'`,
      )
      .bind(
        input.id,
        input.storeId,
        input.name,
        input.sortOrder,
        input.now,
        input.now,
        input.areaId,
        input.storeId,
        input.timeProductId,
        input.storeId,
      )
      .run();
  }

  async listServiceTables(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          st.id, COALESCE(st.display_name, st.name) AS name, st.status, st.version,
          st.sort_order AS sortOrder,
          st.area_id AS areaId, a.name AS areaName,
          st.time_product_id AS timeProductId, p.name AS timeProductName
        FROM service_tables st
        JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
        JOIN products p ON p.id = st.time_product_id AND p.store_id = st.store_id
        WHERE st.store_id = ?
        ORDER BY a.sort_order, st.sort_order, COALESCE(st.display_name, st.name) COLLATE NOCASE`,
      )
      .bind(storeId)
      .all();
  }
}
