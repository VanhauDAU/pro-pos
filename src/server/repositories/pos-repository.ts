export interface TablePricingRow {
  table_id: string;
  table_name: string;
  table_status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  table_version: number;
  product_id: string;
  product_name: string;
  config_id: string;
  pricing_version: number;
  base_price: number;
  base_duration_seconds: number;
  calculation_mode: 'ACTUAL_TIME' | 'TIME_BLOCK';
  rounding_unit: 0 | 100 | 500 | 1000 | 5000;
  first_period_enabled: 0 | 1;
  first_period_duration_seconds: number | null;
  first_period_price: number | null;
}

export interface OrderRow {
  id: string;
  store_id: string;
  table_id: string | null;
  order_type: 'DINE_IN' | 'TAKEAWAY';
  display_code: string | null;
  status: 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
  version: number;
  table_name: string | null;
  area_id: string | null;
  area_name: string | null;
  opened_at: number;
  updated_at: number;
  opened_by_name: string | null;
  note: string | null;
  guest_count: number;
  customer_name: string | null;
  customer_phone: string | null;
}

export interface TimeSessionRow {
  id: string;
  order_id: string;
  table_id: string;
  time_product_id: string;
  status: 'RUNNING' | 'PAUSED' | 'ENDED';
  started_at: number;
  ended_at: number | null;
  pricing_snapshot_json: string;
  pricing_version: number;
}

export interface SaleVariantRow {
  product_id: string;
  product_name: string;
  product_type: 'QUANTITY' | 'WEIGHT' | 'TIME';
  product_status: 'ACTIVE' | 'DISABLED';
  variant_id: string | null;
  variant_name: string | null;
  variant_status: 'ACTIVE' | 'DISABLED' | null;
  sale_price: number | null;
  prompt_price: 0 | 1 | null;
  unit_name: string | null;
}

export interface SaleCatalogRow {
  productId: string;
  productName: string;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  avatarType: 'COLOR' | 'IMAGE';
  avatarColor: string | null;
  mediaId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  variantId: string;
  variantName: string;
  salePriceVnd: number | null;
  promptPrice: 0 | 1;
  unitName: string | null;
}

export interface PosTableRecord {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  version: number;
  areaId: string;
  areaName: string;
  areaSortOrder: number;
  sortOrder: number;
  timeProductId?: string | null;
  timeProductName?: string | null;
  defaultPriceVnd?: number | null;
  defaultDurationSeconds?: number | null;
  activeOrderId: string | null;
  occupiedSince: number | null;
}

export interface TableTimeSegmentRow {
  id: string;
  store_id: string;
  order_id: string;
  time_session_id: string;
  table_id: string;
  time_product_id: string;
  table_name_snapshot: string;
  started_at: number;
  ended_at: number | null;
  pricing_snapshot_json: string;
  pricing_version: number;
  unit_price_snapshot: number;
  created_at: number;
  updated_at: number;
}

export interface OrderItemRow {
  id: string;
  productId: string;
  variantId: string | null;
  productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
  productName: string;
  variantName: string | null;
  unitName: string | null;
  unitPriceVnd: number;
  quantityMilli: number;
  discountType: 'FIXED' | 'PERCENT' | null;
  discountInputValue: number | null;
  discountAmountVnd: number;
  grossLineTotalVnd: number;
  netLineTotalVnd: number;
  lineTotalVnd: number;
  note: string | null;
  timeStartedAtMs: number | null;
  timeEndedAtMs: number | null;
}

export class PosRepository {
  constructor(private readonly db: D1Database) {}

  async listTables(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          st.id, COALESCE(st.display_name, st.name) AS name, st.status, st.version,
          st.area_id AS areaId,
          a.name AS areaName, a.sort_order AS areaSortOrder,
          st.sort_order AS sortOrder,
          st.time_product_id AS timeProductId,
          p.name AS timeProductName,
          tpc.base_price AS defaultPriceVnd,
          tpc.base_duration_seconds AS defaultDurationSeconds,
          o.id AS activeOrderId, o.opened_at AS occupiedSince
        FROM service_tables st
        JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
        LEFT JOIN products p ON p.id = st.time_product_id AND p.store_id = st.store_id
        LEFT JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
        LEFT JOIN orders o ON o.table_id = st.id AND o.store_id = st.store_id
          AND o.order_type = 'DINE_IN' AND o.status IN ('OPEN', 'PAYMENT_PENDING')
        WHERE st.store_id = ?
          AND a.status = 'ACTIVE'
          AND st.status != 'DISABLED'
        ORDER BY a.sort_order, st.sort_order, COALESCE(st.display_name, st.name) COLLATE NOCASE`,
      )
      .bind(storeId)
      .all<PosTableRecord>();
  }

  async listTableTimeSegments(storeId: string, timeSessionId: string) {
    return this.db
      .prepare(
        `SELECT
          id, store_id, order_id, time_session_id, table_id, time_product_id,
          table_name_snapshot, started_at, ended_at, pricing_snapshot_json,
          pricing_version, unit_price_snapshot, created_at, updated_at
        FROM table_time_segments
        WHERE store_id = ? AND time_session_id = ?
        ORDER BY started_at ASC`,
      )
      .bind(storeId, timeSessionId)
      .all<TableTimeSegmentRow>();
  }

  findTablePricing(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT
          st.id AS table_id, COALESCE(st.display_name, st.name) AS table_name,
          st.status AS table_status,
          st.version AS table_version, p.id AS product_id, p.name AS product_name,
          tpc.id AS config_id, tpc.version AS pricing_version,
          tpc.base_price, tpc.base_duration_seconds, tpc.calculation_mode,
          tpc.rounding_unit, tpc.first_period_enabled,
          tpc.first_period_duration_seconds, tpc.first_period_price
        FROM service_tables st
        JOIN products p ON p.id = st.time_product_id AND p.store_id = st.store_id
        JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
        WHERE st.store_id = ? AND st.id = ?
        LIMIT 1`,
      )
      .bind(storeId, tableId)
      .first<TablePricingRow>();
  }

  findProductPricing(storeId: string, productId: string) {
    return this.db
      .prepare(
        `SELECT
          p.id AS product_id, p.name AS product_name,
          tpc.id AS config_id, tpc.version AS pricing_version,
          tpc.base_price, tpc.base_duration_seconds, tpc.calculation_mode,
          tpc.rounding_unit, tpc.first_period_enabled,
          tpc.first_period_duration_seconds, tpc.first_period_price
        FROM products p
        JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
        WHERE p.store_id = ? AND p.id = ?
        LIMIT 1`,
      )
      .bind(storeId, productId)
      .first<{
        product_id: string;
        product_name: string;
        config_id: string;
        pricing_version: number;
        base_price: number;
        base_duration_seconds: number;
        calculation_mode: 'ACTUAL_TIME' | 'TIME_BLOCK';
        rounding_unit: 0 | 100 | 500 | 1000 | 5000;
        first_period_enabled: 0 | 1;
        first_period_duration_seconds: number | null;
        first_period_price: number | null;
      }>();
  }

  async listSpecialWindows(storeId: string, configId: string) {
    return this.db
      .prepare(
        `SELECT id, name, price AS priceVnd, start_minute AS startMinute,
                end_minute AS endMinute, weekdays_mask AS weekdaysMask
         FROM special_price_windows
         WHERE store_id = ? AND time_price_config_id = ?
         ORDER BY name COLLATE NOCASE`,
      )
      .bind(storeId, configId)
      .all<{
        id: string;
        name: string;
        priceVnd: number;
        startMinute: number;
        endMinute: number;
        weekdaysMask: number;
      }>();
  }

  findOpenCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, time_session_id AS timeSessionId, table_id AS tableId,
                display_code AS displayCode
         FROM open_table_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; timeSessionId: string; tableId: string; displayCode: string }>();
  }

  async executeOpenTable(input: {
    commandId: string;
    storeId: string;
    tableId: string;
    expectedTableVersion: number;
    orderId: string;
    timeSessionId: string;
    businessDay: string;
    pricingSnapshotJson: string;
    pricingVersion: number;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO open_table_commands (
          id, store_id, table_id, expected_table_version, order_id,
          time_session_id, pricing_snapshot_json, pricing_version,
          actor_user_id, request_id, issued_at, business_day, display_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.tableId,
        input.expectedTableVersion,
        input.orderId,
        input.timeSessionId,
        input.pricingSnapshotJson,
        input.pricingVersion,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.businessDay,
      )
      .run();
  }

  findOrder(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT o.id, o.store_id, o.table_id, o.order_type,
                COALESCE(o.display_code, 'D' || strftime('%y%m%d', o.opened_at / 1000, 'unixepoch') || '-' || substr(o.id, 1, 4)) AS display_code,
                o.status, o.version, o.opened_at, COALESCE(o.updated_at, o.opened_at) AS updated_at, o.note,
                COALESCE(o.guest_count, 1) AS guest_count, o.customer_name, o.customer_phone,
                COALESCE(st.display_name, st.name) AS table_name,
                a.id AS area_id, a.name AS area_name,
                COALESCE(u.display_name, 'Nhân viên') AS opened_by_name
         FROM orders o
         LEFT JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
         LEFT JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
         LEFT JOIN users u ON u.id = o.opened_by
         WHERE o.store_id = ? AND o.id = ? LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<OrderRow>();
  }

  async listActiveOrders(storeId: string) {
    return this.db
      .prepare(
        `SELECT o.id, o.store_id, o.table_id, o.order_type,
                COALESCE(o.display_code, 'D' || strftime('%y%m%d', o.opened_at / 1000, 'unixepoch') || '-' || substr(o.id, 1, 4)) AS display_code,
                o.status, o.version, o.opened_at, COALESCE(o.updated_at, o.opened_at) AS updated_at, o.note,
                COALESCE(o.guest_count, 1) AS guest_count, o.customer_name, o.customer_phone,
                COALESCE(st.display_name, st.name) AS table_name,
                a.id AS area_id, a.name AS area_name,
                COALESCE(u.display_name, 'Nhân viên') AS opened_by_name
         FROM orders o
         LEFT JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
         LEFT JOIN areas a ON a.id = st.area_id AND a.store_id = o.store_id
         LEFT JOIN users u ON u.id = o.opened_by
         WHERE o.store_id = ? AND o.status IN ('OPEN', 'PAYMENT_PENDING')
         UNION ALL
         SELECT t.id, t.store_id, NULL AS table_id, 'TAKEAWAY' AS order_type,
                COALESCE(t.display_code, 'D' || strftime('%y%m%d', t.opened_at / 1000, 'unixepoch') || '-' || substr(t.id, 1, 4)) AS display_code,
                t.status, t.version, t.opened_at, COALESCE(t.updated_at, t.opened_at) AS updated_at, t.note,
                COALESCE(t.guest_count, 1) AS guest_count, t.customer_name, t.customer_phone,
                NULL AS table_name, NULL AS area_id, NULL AS area_name,
                COALESCE(u.display_name, 'Nhân viên') AS opened_by_name
         FROM takeaway_orders t
         LEFT JOIN users u ON u.id = t.opened_by
         WHERE t.store_id = ? AND t.status IN ('OPEN', 'PAYMENT_PENDING')
         ORDER BY opened_at DESC`,
      )
      .bind(storeId, storeId)
      .all<OrderRow>();
  }

  findTakeawayOrder(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT t.id, t.store_id, NULL AS table_id, 'TAKEAWAY' AS order_type,
                COALESCE(t.display_code, 'D' || strftime('%y%m%d', t.opened_at / 1000, 'unixepoch') || '-' || substr(t.id, 1, 4)) AS display_code,
                t.status, t.version, t.opened_at, COALESCE(t.updated_at, t.opened_at) AS updated_at, t.note,
                COALESCE(t.guest_count, 1) AS guest_count, t.customer_name, t.customer_phone,
                NULL AS table_name, NULL AS area_id, NULL AS area_name,
                COALESCE(u.display_name, 'Nhân viên') AS opened_by_name
         FROM takeaway_orders t
         LEFT JOIN users u ON u.id = t.opened_by
         WHERE t.store_id = ? AND t.id = ? LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<OrderRow>();
  }

  async listTakeawayOrderItems(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT
          id, product_id AS productId, variant_id AS variantId,
          product_type AS productType,
          product_name_snapshot AS productName, variant_name_snapshot AS variantName,
          unit_name_snapshot AS unitName, unit_price_snapshot AS unitPriceVnd,
          quantity_milli AS quantityMilli, discount_type AS discountType,
          discount_input_value AS discountInputValue,
          discount_amount AS discountAmountVnd,
          gross_line_total AS grossLineTotalVnd,
          net_line_total AS netLineTotalVnd,
          net_line_total AS lineTotalVnd, note,
          NULL AS timeStartedAtMs, NULL AS timeEndedAtMs
         FROM takeaway_order_items
         WHERE store_id = ? AND order_id = ? ORDER BY created_at`,
      )
      .bind(storeId, orderId)
      .all<OrderItemRow>();
  }

  findAddTakeawayItemCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT item_id AS itemId, order_id AS orderId
         FROM add_takeaway_item_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ itemId: string; orderId: string }>();
  }

  executeAddTakeawayItem(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    itemId: string;
    productId: string;
    variantId: string | null;
    productType: string;
    productName: string;
    variantName: string | null;
    unitName: string | null;
    unitPriceVnd: number;
    quantityMilli: number;
    discountType: string | null;
    discountInputValue: number | null;
    discountAmountVnd: number;
    grossLineTotalVnd: number;
    netLineTotalVnd: number;
    note: string | null;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO add_takeaway_item_commands (
          id, store_id, order_id, expected_order_version, item_id,
          product_id, variant_id, product_type, product_name_snapshot,
          variant_name_snapshot, unit_name_snapshot, unit_price_snapshot,
          quantity_milli, discount_type, discount_input_value, discount_amount,
          gross_line_total, net_line_total, actor_user_id, request_id, issued_at,
          item_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.itemId,
        input.productId,
        input.variantId,
        input.productType,
        input.productName,
        input.variantName,
        input.unitName,
        input.unitPriceVnd,
        input.quantityMilli,
        input.discountType,
        input.discountInputValue,
        input.discountAmountVnd,
        input.grossLineTotalVnd,
        input.netLineTotalVnd,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.note,
      )
      .run();
  }

  findCreateTakeawayCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, display_code AS displayCode
         FROM create_takeaway_order_commands
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; displayCode: string }>();
  }

  createTakeawayOrder(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    businessDay: string;
    note: string | null;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO create_takeaway_order_commands (
          id, store_id, order_id, display_code, note, actor_user_id, request_id, issued_at,
          business_day
        ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.note,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.businessDay,
      )
      .run();
  }

  async listSaleCatalog(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          p.id AS productId, p.name AS productName, p.product_type AS productType,
          p.avatar_type AS avatarType, p.avatar_color AS avatarColor,
          p.media_id AS mediaId,
          p.category_id AS categoryId, c.name AS categoryName,
          COALESCE(pv.id, tpc.id, p.id) AS variantId,
          COALESCE(pv.name, 'Giá mặc định') AS variantName,
          COALESCE(pv.sale_price, tpc.base_price, 0) AS salePriceVnd,
          COALESCE(pv.prompt_price, 0) AS promptPrice,
          COALESCE(u.name, CASE WHEN p.product_type = 'TIME' THEN 'giờ' ELSE NULL END) AS unitName
         FROM products p
         LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
           AND pv.status = 'ACTIVE'
         LEFT JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
         LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
         WHERE p.store_id = ? AND p.status = 'ACTIVE' AND p.is_system = 0
           AND p.product_type IN ('QUANTITY', 'WEIGHT')
         ORDER BY c.sort_order, p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all<SaleCatalogRow>();
  }

  getStaffContext(storeId: string, actorId: string) {
    return this.db
      .prepare(
        `SELECT s.id AS storeId, s.name AS storeName,
                u.id AS employeeId, u.display_name AS employeeName,
                ss.phone AS storePhone, ss.address AS storeAddress,
                ss.bank_name AS bankName, ss.bank_account_number AS bankAccountNumber,
                ss.bank_account_name AS bankAccountName,
                EXISTS (
                  SELECT 1 FROM store_capabilities sc
                  WHERE sc.store_id = s.id AND sc.capability = 'POS_REALTIME' AND sc.enabled = 1
                ) AS posRealtimeEnabled
         FROM stores s
         JOIN store_memberships sm ON sm.store_id = s.id AND sm.user_id = ?
           AND sm.status = 'ACTIVE' AND sm.deleted_at IS NULL
         JOIN users u ON u.id = sm.user_id
         LEFT JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(actorId, storeId)
      .first<{
        storeId: string;
        storeName: string;
        employeeId: string;
        employeeName: string;
        storePhone: string | null;
        storeAddress: string | null;
        bankName: string | null;
        bankAccountNumber: string | null;
        bankAccountName: string | null;
        posRealtimeEnabled: 0 | 1;
      }>();
  }

  findStoreBankSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT ss.bank_name AS bankName,
                ss.bank_account_number AS bankAccountNumber,
                ss.bank_account_name AS bankAccountName
         FROM store_settings ss
         WHERE ss.store_id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first<{
        bankName: string | null;
        bankAccountNumber: string | null;
        bankAccountName: string | null;
      }>();
  }

  findTimeSession(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT id, order_id, table_id, time_product_id, status, started_at, ended_at,
                pricing_snapshot_json, pricing_version
         FROM time_sessions WHERE store_id = ? AND order_id = ? LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<TimeSessionRow>();
  }

  async listPauses(storeId: string, timeSessionId: string) {
    return this.db
      .prepare(
        `SELECT paused_at AS pausedAtMs, resumed_at AS resumedAtMs
         FROM time_pauses WHERE store_id = ? AND time_session_id = ?
         ORDER BY paused_at`,
      )
      .bind(storeId, timeSessionId)
      .all<{ pausedAtMs: number; resumedAtMs: number | null }>();
  }

  async listOrderItems(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT
          id, product_id AS productId, variant_id AS variantId,
          product_type AS productType,
          product_name_snapshot AS productName, variant_name_snapshot AS variantName,
          unit_name_snapshot AS unitName, unit_price_snapshot AS unitPriceVnd,
          quantity_milli AS quantityMilli, discount_type AS discountType,
          discount_input_value AS discountInputValue,
          discount_amount AS discountAmountVnd,
          gross_line_total AS grossLineTotalVnd,
          net_line_total AS netLineTotalVnd,
          line_total AS lineTotalVnd, note,
          time_started_at AS timeStartedAtMs, time_ended_at AS timeEndedAtMs
        FROM order_items WHERE store_id = ? AND order_id = ? ORDER BY created_at`,
      )
      .bind(storeId, orderId)
      .all<OrderItemRow>();
  }

  findOrderItemType(
    storeId: string,
    orderType: 'DINE_IN' | 'TAKEAWAY',
    orderId: string,
    itemId: string,
  ) {
    const table = orderType === 'DINE_IN' ? 'order_items' : 'takeaway_order_items';
    const timeCols =
      orderType === 'DINE_IN'
        ? 'time_started_at AS timeStartedAtMs, time_ended_at AS timeEndedAtMs'
        : 'NULL AS timeStartedAtMs, NULL AS timeEndedAtMs';
    return this.db
      .prepare(
        `SELECT
          id,
          product_id AS productId,
          variant_id AS variantId,
          variant_name_snapshot AS variantNameSnapshot,
          product_type AS productType,
          unit_price_snapshot AS unitPriceSnapshot,
          discount_type AS discountType,
          discount_input_value AS discountInputValue,
          discount_amount AS discountAmount,
          gross_line_total AS grossLineTotal,
          net_line_total AS netLineTotal,
          ${timeCols}
         FROM ${table}
         WHERE store_id = ? AND order_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, orderId, itemId)
      .first<{
        id: string;
        productId: string;
        variantId: string | null;
        variantNameSnapshot: string | null;
        productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
        unitPriceSnapshot: number;
        discountType: 'FIXED' | 'PERCENT' | null;
        discountInputValue: number | null;
        discountAmount: number;
        grossLineTotal: number;
        netLineTotal: number;
        timeStartedAtMs: number | null;
        timeEndedAtMs: number | null;
      }>();
  }

  findSaleVariant(storeId: string, productId: string, variantId: string | null | undefined) {
    const targetVariantId = variantId ?? null;
    return this.db
      .prepare(
        `SELECT
          p.id AS product_id, p.name AS product_name, p.product_type,
          p.status AS product_status,
          COALESCE(pv.id, tpc.id, p.id) AS variant_id,
          COALESCE(pv.name, 'Giá mặc định') AS variant_name,
          COALESCE(pv.status, 'ACTIVE') AS variant_status,
          COALESCE(pv.sale_price, tpc.base_price, 0) AS sale_price,
          COALESCE(pv.prompt_price, 0) AS prompt_price,
          COALESCE(u.name, CASE WHEN p.product_type = 'TIME' THEN 'giờ' ELSE NULL END) AS unit_name
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
        LEFT JOIN time_price_configs tpc ON tpc.product_id = p.id AND tpc.store_id = p.store_id
        LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
        WHERE p.store_id = ? AND p.id = ?
          AND ((? IS NULL) OR pv.id = ? OR p.product_type = 'TIME')
        LIMIT 1`,
      )
      .bind(storeId, productId, targetVariantId, targetVariantId)
      .first<SaleVariantRow>();
  }

  findAddItemCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT item_id AS itemId, order_id AS orderId
         FROM add_item_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ itemId: string; orderId: string }>();
  }

  findMergeableOrderItem(input: {
    storeId: string;
    orderId: string;
    takeaway: boolean;
    productId: string;
    variantId: string | null;
    unitPriceVnd: number;
    note: string | null;
  }) {
    const table = input.takeaway ? 'takeaway_order_items' : 'order_items';
    return this.db
      .prepare(
        `SELECT id AS itemId
         FROM ${table}
         WHERE store_id = ? AND order_id = ? AND product_id = ?
           AND variant_id IS ? AND unit_price_snapshot = ? AND note IS ?
           AND product_type <> 'TIME' AND discount_type IS NULL
         ORDER BY created_at, id
         LIMIT 1`,
      )
      .bind(
        input.storeId,
        input.orderId,
        input.productId,
        input.variantId,
        input.unitPriceVnd,
        input.note,
      )
      .first<{ itemId: string }>();
  }

  async executeAddItem(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    itemId: string;
    productId: string;
    variantId: string | null;
    productType: string;
    productName: string;
    variantName: string | null;
    unitName: string | null;
    unitPriceVnd: number;
    quantityMilli: number;
    timeStartedAtMs?: number | null | undefined;
    timeEndedAtMs?: number | null | undefined;
    discountType: string | null;
    discountInputValue: number | null;
    discountAmountVnd: number;
    grossLineTotalVnd: number;
    netLineTotalVnd: number;
    note: string | null;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO add_item_commands (
          id, store_id, order_id, expected_order_version, item_id,
          product_id, variant_id, product_type, product_name_snapshot,
          variant_name_snapshot, unit_name_snapshot, unit_price_snapshot,
          quantity_milli, discount_type, discount_value, line_total,
          actor_user_id, request_id, issued_at, discount_input_value,
          discount_amount, gross_line_total, net_line_total, item_note,
          time_started_at, time_ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.itemId,
        input.productId,
        input.variantId,
        input.productType,
        input.productName,
        input.variantName,
        input.unitName,
        input.unitPriceVnd,
        input.quantityMilli,
        input.discountType,
        input.discountAmountVnd,
        input.netLineTotalVnd,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.discountInputValue,
        input.discountAmountVnd,
        input.grossLineTotalVnd,
        input.netLineTotalVnd,
        input.note,
        input.timeStartedAtMs ?? null,
        input.timeEndedAtMs ?? null,
      )
      .run();
  }

  findUpdateItemCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, item_id AS itemId
         FROM update_order_item_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; itemId: string }>();
  }

  updateOrderItem(input: {
    commandId: string;
    storeId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    orderId: string;
    itemId: string;
    expectedOrderVersion: number;
    quantityMilli: number;
    variantId?: string | null | undefined;
    variantName?: string | null | undefined;
    unitPriceVnd?: number | null | undefined;
    discountType?: string | null | undefined;
    discountInputValue?: number | null | undefined;
    discountAmountVnd?: number | null | undefined;
    grossLineTotalVnd?: number | null | undefined;
    netLineTotalVnd?: number | null | undefined;
    timeStartedAtMs?: number | null | undefined;
    timeEndedAtMs?: number | null | undefined;
    note: string | null;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO update_order_item_commands (
          id, store_id, order_type, order_id, item_id, expected_order_version,
          quantity_milli, note, time_started_at, time_ended_at,
          actor_user_id, request_id, issued_at,
          variant_id, variant_name_snapshot, unit_price_snapshot,
          discount_type, discount_input_value, discount_amount,
          gross_line_total, net_line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderType,
        input.orderId,
        input.itemId,
        input.expectedOrderVersion,
        input.quantityMilli,
        input.note,
        input.timeStartedAtMs ?? null,
        input.timeEndedAtMs ?? null,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.variantId ?? null,
        input.variantName ?? null,
        input.unitPriceVnd ?? null,
        input.discountType ?? null,
        input.discountInputValue ?? null,
        input.discountAmountVnd ?? null,
        input.grossLineTotalVnd ?? null,
        input.netLineTotalVnd ?? null,
      )
      .run();
  }

  findRemoveItemCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, item_id AS itemId, 1 AS removed
         FROM remove_order_item_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; itemId: string; removed: boolean }>();
  }

  removeOrderItem(input: {
    commandId: string;
    storeId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    orderId: string;
    itemId: string;
    expectedOrderVersion: number;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO remove_order_item_commands (
          id, store_id, order_type, order_id, item_id, expected_order_version,
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderType,
        input.orderId,
        input.itemId,
        input.expectedOrderVersion,
        input.actorId,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  async removeTimeSession(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    sessionId: string;
    expectedOrderVersion: number;
    reason: string;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    issuedAt: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO remove_time_session_commands (
          id, store_id, order_id, time_session_id, expected_order_version,
          reason, actor_user_id, actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.sessionId,
        input.expectedOrderVersion,
        input.reason,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  findRemoveTimeSessionCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, time_session_id AS timeSessionId
         FROM remove_time_session_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; timeSessionId: string }>();
  }

  async createTimeSessionForOrder(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    timeSessionId: string;
    tableId: string;
    timeProductId: string;
    tableName: string;
    pricingSnapshotJson: string;
    pricingVersion: number;
    startedAtMs: number;
    endedAtMs: number | null;
    status: 'RUNNING' | 'ENDED' | 'PAUSED';
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    now: number;
  }) {
    let basePrice = 0;
    try {
      const parsed = JSON.parse(input.pricingSnapshotJson) as { basePriceVnd?: number };
      basePrice = parsed.basePriceVnd ?? 0;
    } catch {
      basePrice = 0;
    }

    await this.db
      .prepare(
        `INSERT INTO create_time_session_commands (
          id, store_id, order_id, time_session_id, table_id, time_product_id,
          table_name_snapshot, expected_order_version, pricing_snapshot_json,
          pricing_version, unit_price_snapshot, started_at, ended_at, session_status,
          actor_user_id, actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.timeSessionId,
        input.tableId,
        input.timeProductId,
        input.tableName,
        input.expectedOrderVersion,
        input.pricingSnapshotJson,
        input.pricingVersion,
        basePrice,
        input.startedAtMs,
        input.endedAtMs,
        input.status,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findCreateTimeSessionCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, time_session_id AS timeSessionId,
                started_at AS startedAtMs, ended_at AS endedAtMs
         FROM create_time_session_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{
        orderId: string;
        timeSessionId: string;
        startedAtMs: number;
        endedAtMs: number | null;
      }>();
  }

  findUpdateOrderNoteCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId
         FROM update_order_note_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string }>();
  }

  updateOrderNote(input: {
    commandId: string;
    storeId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    orderId: string;
    expectedOrderVersion: number;
    note: string | null;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO update_order_note_commands (
          id, store_id, order_type, order_id, expected_order_version, note,
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderType,
        input.orderId,
        input.expectedOrderVersion,
        input.note,
        input.actorId,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  findUpdateOrderGuestCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId FROM update_order_guest_commands
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string }>();
  }

  updateOrderGuest(input: {
    commandId: string;
    storeId: string;
    orderType: 'DINE_IN' | 'TAKEAWAY';
    orderId: string;
    expectedOrderVersion: number;
    guestCount: number;
    customerName: string | null;
    customerPhone: string | null;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO update_order_guest_commands (
          id, store_id, order_type, order_id, expected_order_version, guest_count,
          customer_name, customer_phone, actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderType,
        input.orderId,
        input.expectedOrderVersion,
        input.guestCount,
        input.customerName,
        input.customerPhone,
        input.actorId,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  findPauseCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId FROM pause_time_commands
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string }>();
  }

  async pauseTime(input: {
    commandId: string;
    pauseId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO pause_time_commands (
          id, store_id, order_id, expected_order_version, pause_id,
          actor_user_id, actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.pauseId,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findResumeCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId FROM resume_time_commands
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string }>();
  }

  async resumeTime(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO resume_time_commands (
          id, store_id, order_id, expected_order_version, actor_user_id,
          actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findUpdateTimeRangeCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, started_at AS startedAtMs, ended_at AS endedAtMs
         FROM update_time_range_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; startedAtMs: number; endedAtMs: number | null }>();
  }

  async updateTimeRange(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    previousStartedAtMs: number;
    previousEndedAtMs: number | null;
    previousStatus: 'RUNNING' | 'PAUSED' | 'ENDED';
    startedAtMs: number;
    endedAtMs: number | null;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO update_time_range_commands (
          id, store_id, order_id, expected_order_version,
          previous_started_at, previous_ended_at, previous_status,
          started_at, ended_at, actor_user_id, actor_session_id,
          device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.previousStartedAtMs,
        input.previousEndedAtMs,
        input.previousStatus,
        input.startedAtMs,
        input.endedAtMs,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findStopTimeCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, issued_at AS stoppedAt
         FROM stop_time_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; stoppedAt: number }>();
  }

  async stopTimeForCheckout(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId?: string | null;
    deviceId?: string | null;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO stop_time_commands (
          id, store_id, order_id, expected_order_version,
          actor_user_id, actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.actorId,
        input.actorSessionId ?? null,
        input.deviceId ?? null,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  findResumeCheckoutCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, issued_at AS resumedAt
         FROM resume_checkout_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; resumedAt: number }>();
  }

  async resumeCheckout(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId?: string | null;
    deviceId?: string | null;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO resume_checkout_commands (
          id, store_id, order_id, expected_order_version,
          actor_user_id, actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.actorId,
        input.actorSessionId ?? null,
        input.deviceId ?? null,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  findCheckoutCommand(storeId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT invoice_id AS invoiceId, payment_id AS paymentId, order_id AS orderId,
                invoice_display_code AS displayCode, total, method
         FROM checkout_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, idempotencyKey)
      .first<{
        invoiceId: string;
        paymentId: string;
        orderId: string;
        displayCode: string;
        total: number;
        method: 'CASH' | 'BANK_TRANSFER';
      }>();
  }

  async executeCheckout(input: {
    idempotencyKey: string;
    storeId: string;
    orderId: string;
    tableId: string;
    expectedOrderVersion: number;
    paymentId: string;
    invoiceId: string;
    businessDay: string;
    method: 'CASH' | 'BANK_TRANSFER';
    subtotal: number;
    discountTotal: number;
    total: number;
    cashReceived: number | null;
    cashChange: number | null;
    timeDescription: string;
    timeElapsedSeconds: number;
    timeAmount: number;
    timeSnapshotJson: string;
    invoiceSnapshotJson: string;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO checkout_commands (
          id, store_id, order_id, table_id, expected_order_version,
          payment_id, invoice_id, invoice_display_code, method, subtotal,
          discount_total, total, cash_received, cash_change,
          time_line_description, time_elapsed_seconds, time_amount,
          time_snapshot_json, invoice_snapshot_json, actor_user_id,
          request_id, issued_at, business_day
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.idempotencyKey,
        input.storeId,
        input.orderId,
        input.tableId,
        input.expectedOrderVersion,
        input.paymentId,
        input.invoiceId,
        input.method,
        input.subtotal,
        input.discountTotal,
        input.total,
        input.cashReceived,
        input.cashChange,
        input.timeDescription,
        input.timeElapsedSeconds,
        input.timeAmount,
        input.timeSnapshotJson,
        input.invoiceSnapshotJson,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.businessDay,
      )
      .run();
  }

  findTakeawayCheckoutCommand(storeId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT invoice_id AS invoiceId, payment_id AS paymentId, order_id AS orderId,
                invoice_display_code AS displayCode, total, method
         FROM takeaway_checkout_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, idempotencyKey)
      .first<{
        invoiceId: string;
        paymentId: string;
        orderId: string;
        displayCode: string;
        total: number;
        method: 'CASH' | 'BANK_TRANSFER';
      }>();
  }

  executeTakeawayCheckout(input: {
    idempotencyKey: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    paymentId: string;
    invoiceId: string;
    businessDay: string;
    method: 'CASH' | 'BANK_TRANSFER';
    subtotal: number;
    discountTotal: number;
    total: number;
    cashReceived: number | null;
    cashChange: number | null;
    invoiceSnapshotJson: string;
    actorId: string;
    requestId: string;
    issuedAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO takeaway_checkout_commands (
          id, store_id, order_id, expected_order_version, payment_id, invoice_id,
          invoice_display_code, method, subtotal, discount_total, total,
          cash_received, cash_change, invoice_snapshot_json, actor_user_id,
          request_id, issued_at, business_day
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.idempotencyKey,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.paymentId,
        input.invoiceId,
        input.method,
        input.subtotal,
        input.discountTotal,
        input.total,
        input.cashReceived,
        input.cashChange,
        input.invoiceSnapshotJson,
        input.actorId,
        input.requestId,
        input.issuedAt,
        input.businessDay,
      )
      .run();
  }

  findInvoiceNumberingSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT s.timezone, ss.business_day_cutoff_minutes AS cutoffMinutes
         FROM stores s JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first<{ timezone: string; cutoffMinutes: number }>();
  }

  findTransferCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId, target_table_id AS targetTableId
         FROM transfer_table_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; targetTableId: string }>();
  }

  async executeTransfer(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    sourceTableId: string;
    targetTableId: string;
    expectedOrderVersion: number;
    expectedSourceVersion: number;
    expectedTargetVersion: number;
    targetPricingSnapshotJson: string;
    targetPricingVersion: number;
    actorId: string;
    requestId: string;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO transfer_table_commands (
          id, store_id, order_id, source_table_id, target_table_id,
          expected_order_version, expected_source_version, expected_target_version,
          target_pricing_snapshot_json, target_pricing_version,
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.sourceTableId,
        input.targetTableId,
        input.expectedOrderVersion,
        input.expectedSourceVersion,
        input.expectedTargetVersion,
        input.targetPricingSnapshotJson,
        input.targetPricingVersion,
        input.actorId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findCancelCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId FROM cancel_order_commands
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string }>();
  }

  findCancelTakeawayCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT order_id AS orderId FROM cancel_takeaway_order_commands
         WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string }>();
  }

  executeCancelTakeaway(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    reason: string;
    actorId: string;
    requestId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO cancel_takeaway_order_commands (
          id, store_id, order_id, expected_order_version, reason,
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.expectedOrderVersion,
        input.reason,
        input.actorId,
        input.requestId,
        input.now,
      )
      .run();
  }

  async executeCancel(input: {
    commandId: string;
    storeId: string;
    orderId: string;
    tableId: string;
    expectedOrderVersion: number;
    reason: string;
    actorId: string;
    requestId: string;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO cancel_order_commands (
          id, store_id, order_id, table_id, expected_order_version,
          reason, actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.orderId,
        input.tableId,
        input.expectedOrderVersion,
        input.reason,
        input.actorId,
        input.requestId,
        input.now,
      )
      .run();
  }

  async listInvoices(storeId: string, limit: number) {
    return this.db
      .prepare(
        `SELECT id, order_id AS orderId, display_code AS displayCode,
                subtotal, discount_total AS discountTotal, total,
                status, issued_at AS issuedAt, 'DINE_IN' AS orderType
         FROM invoices WHERE store_id = ?
         UNION ALL
         SELECT id, order_id AS orderId, display_code AS displayCode,
                subtotal, discount_total AS discountTotal, total,
                status, issued_at AS issuedAt, 'TAKEAWAY' AS orderType
         FROM takeaway_invoices WHERE store_id = ?
         ORDER BY issuedAt DESC LIMIT ?`,
      )
      .bind(storeId, storeId, limit)
      .all();
  }

  async getInvoice(storeId: string, invoiceId: string) {
    const invoice = await this.db
      .prepare(
        `SELECT id, order_id AS orderId, display_code AS displayCode,
                subtotal, discount_total AS discountTotal, total,
                status, issued_at AS issuedAt, snapshot_json AS snapshotJson,
                'DINE_IN' AS orderType
         FROM invoices WHERE store_id = ? AND id = ?
         UNION ALL
         SELECT id, order_id AS orderId, display_code AS displayCode,
                subtotal, discount_total AS discountTotal, total,
                status, issued_at AS issuedAt, snapshot_json AS snapshotJson,
                'TAKEAWAY' AS orderType
         FROM takeaway_invoices WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, invoiceId, storeId, invoiceId)
      .first<{ orderType: 'DINE_IN' | 'TAKEAWAY' } & Record<string, unknown>>();
    const lines = invoice
      ? await this.db
          .prepare(
            invoice.orderType === 'TAKEAWAY'
              ? `SELECT id, line_type AS lineType, description,
                    quantity_milli AS quantityMilli, unit_price AS unitPrice,
                    discount_type AS discountType,
                    discount_input_value AS discountInputValue,
                    discount_amount AS discountAmount,
                    gross_line_total AS grossLineTotal, line_total AS lineTotal,
                    snapshot_json AS snapshotJson
                 FROM takeaway_invoice_lines
                 WHERE store_id = ? AND invoice_id = ? ORDER BY rowid`
              : `SELECT id, line_type AS lineType, description,
                    quantity_milli AS quantityMilli, unit_price AS unitPrice,
                    discount_type AS discountType,
                    discount_input_value AS discountInputValue,
                    discount_amount AS discountAmount,
                    gross_line_total AS grossLineTotal, line_total AS lineTotal,
                    snapshot_json AS snapshotJson
                 FROM invoice_lines
                 WHERE store_id = ? AND invoice_id = ? ORDER BY rowid`,
          )
          .bind(storeId, invoiceId)
          .all()
      : { results: [] };
    const payment = invoice
      ? await this.db
          .prepare(
            invoice.orderType === 'TAKEAWAY'
              ? `SELECT method, amount, cash_received AS cashReceived,
                    cash_change AS cashChange, created_at AS createdAt
                 FROM takeaway_payments
                 WHERE store_id = ? AND order_id = ? AND status = 'SUCCEEDED' LIMIT 1`
              : `SELECT method, amount, cash_received AS cashReceived,
                    cash_change AS cashChange, created_at AS createdAt
                 FROM payments
                 WHERE store_id = ? AND order_id = ? AND status = 'SUCCEEDED' LIMIT 1`,
          )
          .bind(storeId, invoice.orderId)
          .first()
      : null;
    return { invoice, lines: lines.results, payment };
  }

  async findOrderDetailRaw(storeId: string, orderId: string) {
    const dineIn = await this.db
      .prepare(
        `SELECT
          o.id,
          COALESCE(o.display_code, i.display_code, 'D-' || substr(o.id, 1, 8)) AS display_code,
          'DINE_IN' AS order_type,
          o.status,
          o.version,
          o.store_id,
          s.name AS store_name,
          o.table_id,
          COALESCE(st.display_name, st.name) AS table_name,
          st.area_id,
          a.name AS area_name,
          o.opened_at,
          o.opened_by AS opened_by_id,
          u_open.display_name AS opened_by_name,
          o.closed_at,
          o.cancelled_at,
          o.cancel_reason,
          u_cancel.display_name AS cancelled_by_name,
          o.note
        FROM orders o
        JOIN stores s ON s.id = o.store_id
        LEFT JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
        LEFT JOIN areas a ON a.id = st.area_id AND a.store_id = o.store_id
        LEFT JOIN users u_open ON u_open.id = o.opened_by
        LEFT JOIN invoices i ON i.store_id = o.store_id AND i.order_id = o.id
        LEFT JOIN cancel_order_commands coc ON coc.store_id = o.store_id AND coc.order_id = o.id
        LEFT JOIN users u_cancel ON u_cancel.id = coc.actor_user_id
        WHERE o.store_id = ? AND o.id = ?
        LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<{
        id: string;
        display_code: string;
        order_type: 'DINE_IN';
        status: 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
        version: number;
        store_id: string;
        store_name: string;
        table_id: string | null;
        table_name: string | null;
        area_id: string | null;
        area_name: string | null;
        opened_at: number;
        opened_by_id: string;
        opened_by_name: string | null;
        closed_at: number | null;
        cancelled_at: number | null;
        cancel_reason: string | null;
        cancelled_by_name: string | null;
        note: string | null;
      }>();

    if (dineIn) return dineIn;

    const takeaway = await this.db
      .prepare(
        `SELECT
          o.id,
          COALESCE(o.display_code, i.display_code, 'D-' || substr(o.id, 1, 8)) AS display_code,
          'TAKEAWAY' AS order_type,
          o.status,
          o.version,
          o.store_id,
          s.name AS store_name,
          NULL AS table_id,
          NULL AS table_name,
          NULL AS area_id,
          NULL AS area_name,
          o.opened_at,
          o.opened_by AS opened_by_id,
          u_open.display_name AS opened_by_name,
          o.closed_at,
          o.cancelled_at,
          o.cancel_reason,
          u_cancel.display_name AS cancelled_by_name,
          o.note
        FROM takeaway_orders o
        JOIN stores s ON s.id = o.store_id
        LEFT JOIN users u_open ON u_open.id = o.opened_by
        LEFT JOIN takeaway_invoices i ON i.store_id = o.store_id AND i.order_id = o.id
        LEFT JOIN cancel_takeaway_order_commands coc ON coc.store_id = o.store_id AND coc.order_id = o.id
        LEFT JOIN users u_cancel ON u_cancel.id = coc.actor_user_id
        WHERE o.store_id = ? AND o.id = ?
        LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<{
        id: string;
        display_code: string;
        order_type: 'TAKEAWAY';
        status: 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
        version: number;
        store_id: string;
        store_name: string;
        table_id: null;
        table_name: null;
        area_id: null;
        area_name: null;
        opened_at: number;
        opened_by_id: string;
        opened_by_name: string | null;
        closed_at: number | null;
        cancelled_at: number | null;
        cancel_reason: string | null;
        cancelled_by_name: string | null;
        note: string | null;
      }>();

    return takeaway ?? null;
  }

  async listOrderTimeSegmentsDetail(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT
          tts.id,
          tts.table_id AS tableId,
          tts.table_name_snapshot AS tableName,
          a.name AS areaName,
          tts.time_product_id AS timeProductId,
          COALESCE(p.name, 'Giá tính giờ') AS rateNameSnapshot,
          tts.started_at AS startedAt,
          tts.ended_at AS endedAt,
          tts.unit_price_snapshot AS unitPriceSnapshot,
          tts.pricing_snapshot_json AS pricingSnapshotJson,
          tts.pricing_version AS pricingVersion
        FROM table_time_segments tts
        LEFT JOIN service_tables st ON st.id = tts.table_id AND st.store_id = tts.store_id
        LEFT JOIN areas a ON a.id = st.area_id AND a.store_id = tts.store_id
        LEFT JOIN products p ON p.id = tts.time_product_id AND p.store_id = tts.store_id
        WHERE tts.store_id = ? AND tts.order_id = ?
        ORDER BY tts.started_at ASC`,
      )
      .bind(storeId, orderId)
      .all<{
        id: string;
        tableId: string;
        tableName: string;
        areaName: string | null;
        timeProductId: string;
        rateNameSnapshot: string;
        startedAt: number;
        endedAt: number | null;
        unitPriceSnapshot: number;
        pricingSnapshotJson: string;
        pricingVersion: number;
      }>();
  }

  async listOrderTableTransfers(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT
          ttc.id,
          ttc.source_table_id AS fromTableId,
          COALESCE(st_src.display_name, st_src.name, 'Bàn nguồn') AS fromTableName,
          ttc.target_table_id AS toTableId,
          COALESCE(st_tgt.display_name, st_tgt.name, 'Bàn đích') AS toTableName,
          ttc.issued_at AS transferredAt,
          ttc.actor_user_id AS employeeId,
          COALESCE(u.display_name, 'Nhân viên') AS employeeName,
          COALESCE(json_extract(ttc.target_pricing_snapshot_json, '$.basePriceVnd'), 0) AS newRateVnd
        FROM transfer_table_commands ttc
        LEFT JOIN service_tables st_src ON st_src.id = ttc.source_table_id AND st_src.store_id = ttc.store_id
        LEFT JOIN service_tables st_tgt ON st_tgt.id = ttc.target_table_id AND st_tgt.store_id = ttc.store_id
        LEFT JOIN users u ON u.id = ttc.actor_user_id
        WHERE ttc.store_id = ? AND ttc.order_id = ?
        ORDER BY ttc.issued_at ASC`,
      )
      .bind(storeId, orderId)
      .all<{
        id: string;
        fromTableId: string;
        fromTableName: string;
        toTableId: string;
        toTableName: string;
        transferredAt: number;
        employeeId: string;
        employeeName: string;
        newRateVnd: number;
      }>();
  }

  async listOrderItemsWithActors(storeId: string, orderId: string, isTakeaway: boolean) {
    if (isTakeaway) {
      return this.db
        .prepare(
          `SELECT
            oi.id,
            oi.product_id AS productId,
            oi.variant_id AS variantId,
            oi.product_type AS productType,
            oi.product_name_snapshot AS productNameSnapshot,
            oi.variant_name_snapshot AS variantNameSnapshot,
            oi.unit_name_snapshot AS unitNameSnapshot,
            oi.unit_price_snapshot AS unitPriceSnapshot,
            oi.quantity_milli AS quantityMilli,
            oi.gross_line_total AS grossLineTotalVnd,
            oi.discount_type AS discountType,
            oi.discount_input_value AS discountInputValue,
            oi.discount_amount AS discountAmountVnd,
            oi.net_line_total AS netLineTotalVnd,
            oi.note,
            oi.added_by AS addedById,
            u.display_name AS addedByName,
            oi.created_at AS addedAt,
            NULL AS timeStartedAtMs,
            NULL AS timeEndedAtMs,
            p.avatar_type AS avatarType,
            p.avatar_color AS avatarColor,
            p.media_id AS mediaId
          FROM takeaway_order_items oi
          LEFT JOIN users u ON u.id = oi.added_by
          LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = oi.store_id
          WHERE oi.store_id = ? AND oi.order_id = ?
          ORDER BY oi.created_at ASC`,
        )
        .bind(storeId, orderId)
        .all<{
          id: string;
          productId: string;
          variantId: string | null;
          productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
          productNameSnapshot: string;
          variantNameSnapshot: string | null;
          unitNameSnapshot: string | null;
          unitPriceSnapshot: number;
          quantityMilli: number;
          grossLineTotalVnd: number;
          discountType: 'FIXED' | 'PERCENT' | null;
          discountInputValue: number | null;
          discountAmountVnd: number;
          netLineTotalVnd: number;
          note: string | null;
          addedById: string | null;
          addedByName: string | null;
          addedAt: number | null;
          timeStartedAtMs: number | null;
          timeEndedAtMs: number | null;
          avatarType?: 'COLOR' | 'IMAGE' | null;
          avatarColor?: string | null;
          mediaId?: string | null;
        }>();
    }

    return this.db
      .prepare(
        `SELECT
          oi.id,
          oi.product_id AS productId,
          oi.variant_id AS variantId,
          oi.product_type AS productType,
          oi.product_name_snapshot AS productNameSnapshot,
          oi.variant_name_snapshot AS variantNameSnapshot,
          oi.unit_name_snapshot AS unitNameSnapshot,
          oi.unit_price_snapshot AS unitPriceSnapshot,
          oi.quantity_milli AS quantityMilli,
          COALESCE(oi.gross_line_total, oi.line_total) AS grossLineTotalVnd,
          oi.discount_type AS discountType,
          oi.discount_input_value AS discountInputValue,
          COALESCE(oi.discount_amount, oi.discount_value, 0) AS discountAmountVnd,
          COALESCE(oi.net_line_total, oi.line_total) AS netLineTotalVnd,
          oi.note,
          oi.added_by AS addedById,
          u.display_name AS addedByName,
          oi.created_at AS addedAt,
          oi.time_started_at AS timeStartedAtMs,
          oi.time_ended_at AS timeEndedAtMs,
          p.avatar_type AS avatarType,
          p.avatar_color AS avatarColor,
          p.media_id AS mediaId
        FROM order_items oi
        LEFT JOIN users u ON u.id = oi.added_by
        LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = oi.store_id
        WHERE oi.store_id = ? AND oi.order_id = ?
        ORDER BY oi.created_at ASC`,
      )
      .bind(storeId, orderId)
      .all<{
        id: string;
        productId: string;
        variantId: string | null;
        productType: 'QUANTITY' | 'WEIGHT' | 'TIME';
        productNameSnapshot: string;
        variantNameSnapshot: string | null;
        unitNameSnapshot: string | null;
        unitPriceSnapshot: number;
        quantityMilli: number;
        grossLineTotalVnd: number;
        discountType: 'FIXED' | 'PERCENT' | null;
        discountInputValue: number | null;
        discountAmountVnd: number;
        netLineTotalVnd: number;
        note: string | null;
        addedById: string | null;
        addedByName: string | null;
        addedAt: number | null;
        timeStartedAtMs: number | null;
        timeEndedAtMs: number | null;
        avatarType?: 'COLOR' | 'IMAGE' | null;
        avatarColor?: string | null;
        mediaId?: string | null;
      }>();
  }

  async listOrderPaymentsDetail(storeId: string, orderId: string, isTakeaway: boolean) {
    const table = isTakeaway ? 'takeaway_payments' : 'payments';
    return this.db
      .prepare(
        `SELECT
          p.id,
          p.method,
          p.status,
          p.amount,
          p.cash_received AS cashReceived,
          p.cash_change AS cashChange,
          p.idempotency_key AS transactionRef,
          p.created_by AS createdById,
          u.display_name AS createdByName,
          p.created_at AS createdAt
        FROM ${table} p
        LEFT JOIN users u ON u.id = p.created_by
        WHERE p.store_id = ? AND p.order_id = ?
        ORDER BY p.created_at ASC`,
      )
      .bind(storeId, orderId)
      .all<{
        id: string;
        method: 'CASH' | 'BANK_TRANSFER';
        status: 'SUCCEEDED' | 'PENDING' | 'VOIDED';
        amount: number;
        cashReceived: number | null;
        cashChange: number | null;
        transactionRef: string | null;
        createdById: string;
        createdByName: string | null;
        createdAt: number;
      }>();
  }

  async findOrderInvoiceDetail(storeId: string, orderId: string, isTakeaway: boolean) {
    const table = isTakeaway ? 'takeaway_invoices' : 'invoices';
    return this.db
      .prepare(
        `SELECT
          i.id,
          i.display_code AS displayCode,
          i.status,
          i.issued_at AS issuedAt,
          i.issued_by AS issuedById,
          u.display_name AS issuedByName,
          i.subtotal AS subtotalVnd,
          i.discount_total AS discountTotalVnd,
          i.total AS totalVnd,
          i.snapshot_json AS snapshotJson
        FROM ${table} i
        LEFT JOIN users u ON u.id = i.issued_by
        WHERE i.store_id = ? AND i.order_id = ?
        LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<{
        id: string;
        displayCode: string;
        status: 'COMPLETED' | 'CANCELLED';
        issuedAt: number;
        issuedById: string;
        issuedByName: string | null;
        subtotalVnd: number;
        discountTotalVnd: number;
        totalVnd: number;
        snapshotJson: string;
      }>();
  }

  async listOrderStopAndResumeCommands(storeId: string, orderId: string) {
    const stops = await this.db
      .prepare(
        `SELECT stc.id, stc.issued_at AS stoppedAt, stc.actor_user_id AS actorUserId, u.display_name AS actorName
         FROM stop_time_commands stc
         LEFT JOIN users u ON u.id = stc.actor_user_id
         WHERE stc.store_id = ? AND stc.order_id = ?
         ORDER BY stc.issued_at ASC`,
      )
      .bind(storeId, orderId)
      .all<{
        id: string;
        stoppedAt: number;
        actorUserId: string;
        actorName: string | null;
      }>();

    const resumes = await this.db
      .prepare(
        `SELECT rcc.id, rcc.issued_at AS resumedAt, rcc.actor_user_id AS actorUserId, u.display_name AS actorName
         FROM resume_checkout_commands rcc
         LEFT JOIN users u ON u.id = rcc.actor_user_id
         WHERE rcc.store_id = ? AND rcc.order_id = ?
         ORDER BY rcc.issued_at ASC`,
      )
      .bind(storeId, orderId)
      .all<{
        id: string;
        resumedAt: number;
        actorUserId: string;
        actorName: string | null;
      }>();

    return { stops: stops.results, resumes: resumes.results };
  }

  async listOrderAuditLogsDetail(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT
          al.id,
          al.action,
          al.entity_type AS entityType,
          al.entity_id AS entityId,
          al.actor_user_id AS actorId,
          u.display_name AS actorName,
          al.before_json AS beforeJson,
          al.after_json AS afterJson,
          al.created_at AS eventAt
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.store_id = ? AND (
          al.entity_id = ?
          OR json_extract(al.after_json, '$.orderId') = ?
          OR json_extract(al.after_json, '$.order_id') = ?
          OR json_extract(al.before_json, '$.orderId') = ?
          OR al.entity_id IN (SELECT id FROM order_items WHERE store_id = ? AND order_id = ?)
          OR al.entity_id IN (SELECT id FROM takeaway_order_items WHERE store_id = ? AND order_id = ?)
          OR al.entity_id IN (SELECT id FROM invoices WHERE store_id = ? AND order_id = ?)
          OR al.entity_id IN (SELECT id FROM takeaway_invoices WHERE store_id = ? AND order_id = ?)
        )
        ORDER BY al.created_at ASC`,
      )
      .bind(
        storeId,
        orderId,
        orderId,
        orderId,
        orderId,
        storeId,
        orderId,
        storeId,
        orderId,
        storeId,
        orderId,
        storeId,
        orderId,
      )
      .all<{
        id: string;
        action: string;
        entityType: string;
        entityId: string | null;
        actorId: string | null;
        actorName: string | null;
        beforeJson: string | null;
        afterJson: string | null;
        eventAt: number;
      }>();
  }
}
