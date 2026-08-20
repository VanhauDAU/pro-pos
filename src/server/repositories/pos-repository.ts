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
  table_id: string;
  status: 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
  version: number;
  table_name: string;
}

export interface TimeSessionRow {
  id: string;
  order_id: string;
  table_id: string;
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

export class PosRepository {
  constructor(private readonly db: D1Database) {}

  async listTables(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          st.id, st.name, st.status, st.version, st.area_id AS areaId,
          a.name AS areaName, st.sort_order AS sortOrder
        FROM service_tables st
        JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
        WHERE st.store_id = ?
        ORDER BY a.sort_order, st.sort_order, st.name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all();
  }

  findTablePricing(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT
          st.id AS table_id, st.name AS table_name, st.status AS table_status,
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
        `SELECT order_id AS orderId, time_session_id AS timeSessionId, table_id AS tableId
         FROM open_table_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ orderId: string; timeSessionId: string; tableId: string }>();
  }

  async executeOpenTable(input: {
    commandId: string;
    storeId: string;
    tableId: string;
    expectedTableVersion: number;
    orderId: string;
    timeSessionId: string;
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
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
      .run();
  }

  findOrder(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT o.id, o.store_id, o.table_id, o.status, o.version, st.name AS table_name
         FROM orders o
         JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
         WHERE o.store_id = ? AND o.id = ? LIMIT 1`,
      )
      .bind(storeId, orderId)
      .first<OrderRow>();
  }

  findTimeSession(storeId: string, orderId: string) {
    return this.db
      .prepare(
        `SELECT id, order_id, table_id, status, started_at, ended_at,
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
          product_name_snapshot AS productName, variant_name_snapshot AS variantName,
          unit_name_snapshot AS unitName, unit_price_snapshot AS unitPriceVnd,
          quantity_milli AS quantityMilli, discount_type AS discountType,
          discount_value AS discountValue, line_total AS lineTotalVnd
        FROM order_items WHERE store_id = ? AND order_id = ? ORDER BY created_at`,
      )
      .bind(storeId, orderId)
      .all();
  }

  findSaleVariant(storeId: string, productId: string, variantId: string | null) {
    return this.db
      .prepare(
        `SELECT
          p.id AS product_id, p.name AS product_name, p.product_type,
          p.status AS product_status, pv.id AS variant_id, pv.name AS variant_name,
          pv.status AS variant_status, pv.sale_price, pv.prompt_price,
          u.name AS unit_name
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
        LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
        WHERE p.store_id = ? AND p.id = ?
          AND ((? IS NULL AND pv.id IS NULL) OR pv.id = ?)
        LIMIT 1`,
      )
      .bind(storeId, productId, variantId, variantId)
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
    discountType: string | null;
    discountValue: number;
    lineTotalVnd: number;
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
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.discountValue,
        input.lineTotalVnd,
        input.actorId,
        input.requestId,
        input.issuedAt,
      )
      .run();
  }

  async pauseTime(input: {
    pauseId: string;
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    actorId: string;
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare(
          `UPDATE orders SET version = version + 1, updated_at = ?
           WHERE id = ? AND store_id = ? AND status = 'OPEN' AND version = ?`,
        )
        .bind(input.now, input.orderId, input.storeId, input.expectedOrderVersion),
      this.db
        .prepare(
          `INSERT INTO time_pauses (
            id, store_id, time_session_id, paused_at, actor_user_id, created_at
          )
          SELECT ?, ?, ts.id, ?, ?, ?
          FROM time_sessions ts JOIN orders o ON o.id = ts.order_id
          WHERE ts.store_id = ? AND ts.order_id = ? AND ts.status = 'RUNNING'
            AND o.version = ?`,
        )
        .bind(
          input.pauseId,
          input.storeId,
          input.now,
          input.actorId,
          input.now,
          input.storeId,
          input.orderId,
          input.expectedOrderVersion + 1,
        ),
      this.db
        .prepare(
          `UPDATE time_sessions SET status = 'PAUSED', updated_at = ?
           WHERE store_id = ? AND order_id = ? AND status = 'RUNNING'
             AND EXISTS (
               SELECT 1 FROM time_pauses
               WHERE id = ? AND time_session_id = time_sessions.id
             )`,
        )
        .bind(input.now, input.storeId, input.orderId, input.pauseId),
    ]);
  }

  async resumeTime(input: {
    storeId: string;
    orderId: string;
    expectedOrderVersion: number;
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare(
          `UPDATE orders SET version = version + 1, updated_at = ?
           WHERE id = ? AND store_id = ? AND status = 'OPEN' AND version = ?`,
        )
        .bind(input.now, input.orderId, input.storeId, input.expectedOrderVersion),
      this.db
        .prepare(
          `UPDATE time_pauses SET resumed_at = ?
           WHERE store_id = ? AND resumed_at IS NULL
             AND time_session_id = (
               SELECT ts.id FROM time_sessions ts
               JOIN orders o ON o.id = ts.order_id
               WHERE ts.store_id = ? AND ts.order_id = ? AND ts.status = 'PAUSED'
                 AND o.version = ?
             )`,
        )
        .bind(
          input.now,
          input.storeId,
          input.storeId,
          input.orderId,
          input.expectedOrderVersion + 1,
        ),
      this.db
        .prepare(
          `UPDATE time_sessions SET status = 'RUNNING', updated_at = ?
           WHERE store_id = ? AND order_id = ? AND status = 'PAUSED'
             AND NOT EXISTS (
               SELECT 1 FROM time_pauses
               WHERE time_session_id = time_sessions.id AND resumed_at IS NULL
             )`,
        )
        .bind(input.now, input.storeId, input.orderId),
    ]);
  }

  findCheckoutCommand(storeId: string, idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT invoice_id AS invoiceId, payment_id AS paymentId, order_id AS orderId,
                total, method
         FROM checkout_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, idempotencyKey)
      .first<{
        invoiceId: string;
        paymentId: string;
        orderId: string;
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
    invoiceDisplayCode: string;
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
          request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.idempotencyKey,
        input.storeId,
        input.orderId,
        input.tableId,
        input.expectedOrderVersion,
        input.paymentId,
        input.invoiceId,
        input.invoiceDisplayCode,
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
      )
      .run();
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
    actorId: string;
    requestId: string;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO transfer_table_commands (
          id, store_id, order_id, source_table_id, target_table_id,
          expected_order_version, expected_source_version, expected_target_version,
          actor_user_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                status, issued_at AS issuedAt
         FROM invoices WHERE store_id = ? ORDER BY issued_at DESC LIMIT ?`,
      )
      .bind(storeId, limit)
      .all();
  }

  async getInvoice(storeId: string, invoiceId: string) {
    const invoice = await this.db
      .prepare(
        `SELECT id, order_id AS orderId, display_code AS displayCode,
                subtotal, discount_total AS discountTotal, total,
                status, issued_at AS issuedAt, snapshot_json AS snapshotJson
         FROM invoices WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, invoiceId)
      .first();
    const lines = await this.db
      .prepare(
        `SELECT id, line_type AS lineType, description, quantity_milli AS quantityMilli,
                unit_price AS unitPrice, discount_amount AS discountAmount,
                line_total AS lineTotal, snapshot_json AS snapshotJson
         FROM invoice_lines WHERE store_id = ? AND invoice_id = ? ORDER BY rowid`,
      )
      .bind(storeId, invoiceId)
      .all();
    return { invoice, lines: lines.results };
  }
}
