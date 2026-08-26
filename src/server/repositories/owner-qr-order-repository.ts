import type { QuickReasonInput, UpdateOwnerQrOrderSettingsInput } from '@contracts/owner-qr-order';

export interface QrOrderSettingsRow {
  timezone: string;
  locationVerificationEnabled: 0 | 1;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
  locationMemoryMinutes: number;
  orderCooldownSeconds: number;
  callStaffCooldownSeconds: number;
  checkoutCooldownSeconds: number;
  salesScheduleEnabled: 0 | 1;
  salesPaused: 0 | 1;
  salesPausedAt: number | null;
}

export class OwnerQrOrderRepository {
  constructor(private readonly db: D1Database) {}

  getSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT s.timezone,
                ss.location_verification_enabled AS locationVerificationEnabled,
                ss.latitude, ss.longitude,
                ss.allowed_radius_meters AS allowedRadiusMeters,
                ss.max_accuracy_meters AS maxAccuracyMeters,
                ss.qr_location_memory_minutes AS locationMemoryMinutes,
                ss.qr_order_cooldown_seconds AS orderCooldownSeconds,
                ss.qr_call_staff_cooldown_seconds AS callStaffCooldownSeconds,
                ss.qr_checkout_cooldown_seconds AS checkoutCooldownSeconds,
                ss.qr_sales_schedule_enabled AS salesScheduleEnabled,
                ss.qr_sales_paused AS salesPaused,
                ss.qr_sales_paused_at AS salesPausedAt
         FROM stores s JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first<QrOrderSettingsRow>();
  }

  listSalesHours(storeId: string) {
    return this.db
      .prepare(
        `SELECT id, weekday, start_minute AS startMinute, end_minute AS endMinute
         FROM qr_order_sales_hours WHERE store_id = ?
         ORDER BY weekday, start_minute`,
      )
      .bind(storeId)
      .all<{ id: string; weekday: number; startMinute: number; endMinute: number }>();
  }

  listQuickReasons(storeId: string, activeOnly = false) {
    return this.db
      .prepare(
        `SELECT id, label, status, sort_order AS sortOrder
         FROM qr_order_quick_reasons
         WHERE store_id = ? AND archived = 0 AND (? = 0 OR status = 'ACTIVE')
         ORDER BY sort_order, label COLLATE NOCASE`,
      )
      .bind(storeId, activeOnly ? 1 : 0)
      .all<{
        id: string;
        label: string;
        status: 'ACTIVE' | 'DISABLED';
        sortOrder: number;
      }>();
  }

  async updateSettings(input: {
    storeId: string;
    values: UpdateOwnerQrOrderSettingsInput;
    invalidateLocations: boolean;
    now: number;
  }) {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE store_settings SET
             location_verification_enabled = ?, latitude = ?, longitude = ?,
             allowed_radius_meters = ?, max_accuracy_meters = ?,
             qr_location_memory_minutes = ?, qr_order_cooldown_seconds = ?,
             qr_call_staff_cooldown_seconds = ?, qr_checkout_cooldown_seconds = ?,
             qr_sales_schedule_enabled = ?, updated_at = ?
           WHERE store_id = ?`,
        )
        .bind(
          input.values.locationVerificationEnabled ? 1 : 0,
          input.values.latitude,
          input.values.longitude,
          input.values.allowedRadiusMeters,
          input.values.maxAccuracyMeters,
          input.values.locationMemoryMinutes,
          input.values.orderCooldownSeconds,
          input.values.callStaffCooldownSeconds,
          input.values.checkoutCooldownSeconds,
          input.values.salesScheduleEnabled ? 1 : 0,
          input.now,
          input.storeId,
        ),
      this.db.prepare('DELETE FROM qr_order_sales_hours WHERE store_id = ?').bind(input.storeId),
      ...input.values.salesHours.map((window, index) =>
        this.db
          .prepare(
            `INSERT INTO qr_order_sales_hours (
               id, store_id, weekday, start_minute, end_minute, sort_order, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.storeId,
            window.weekday,
            window.startMinute,
            window.endMinute,
            index,
            input.now,
            input.now,
          ),
      ),
    ];
    if (input.invalidateLocations) {
      statements.push(
        this.db
          .prepare(
            `UPDATE guest_order_sessions SET location_verified_at = NULL,
               location_distance_meters = NULL, location_accuracy_meters = NULL,
               location_expires_at = NULL
             WHERE store_id = ? AND status = 'ACTIVE'`,
          )
          .bind(input.storeId),
      );
    }
    await this.db.batch(statements);
  }

  setSalesPaused(storeId: string, paused: boolean, now: number) {
    return this.db
      .prepare(
        `UPDATE store_settings SET qr_sales_paused = ?, qr_sales_paused_at = ?, updated_at = ?
         WHERE store_id = ?`,
      )
      .bind(paused ? 1 : 0, paused ? now : null, now, storeId)
      .run();
  }

  listTables(storeId: string) {
    return this.db
      .prepare(
        `SELECT st.id, COALESCE(st.display_name, st.name) AS name, st.status,
                st.area_id AS areaId, a.name AS areaName,
                st.qr_order_enabled AS qrOrderEnabled,
                qr.public_token AS publicToken
         FROM service_tables st
         JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
         LEFT JOIN table_qr_codes qr ON qr.table_id = st.id AND qr.store_id = st.store_id
         WHERE st.store_id = ? AND a.status = 'ACTIVE'
         ORDER BY a.sort_order, st.sort_order, name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all<{
        id: string;
        name: string;
        status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
        areaId: string;
        areaName: string;
        qrOrderEnabled: 0 | 1;
        publicToken: string | null;
      }>();
  }

  findTable(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT id, status, qr_order_enabled AS qrOrderEnabled
         FROM service_tables WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, tableId)
      .first<{
        id: string;
        status: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
        qrOrderEnabled: 0 | 1;
      }>();
  }

  setTableQrEnabled(storeId: string, tableId: string, enabled: boolean, now: number) {
    return this.db
      .prepare(
        `UPDATE service_tables SET qr_order_enabled = ?, version = version + 1, updated_at = ?
         WHERE store_id = ? AND id = ?`,
      )
      .bind(enabled ? 1 : 0, now, storeId, tableId)
      .run();
  }

  async setTablesQrEnabled(storeId: string, tableIds: string[], enabled: boolean, now: number) {
    await this.db.batch(
      tableIds.map((tableId) =>
        this.db
          .prepare(
            `UPDATE service_tables SET qr_order_enabled = ?, version = version + 1, updated_at = ?
             WHERE store_id = ? AND id = ?`,
          )
          .bind(enabled ? 1 : 0, now, storeId, tableId),
      ),
    );
  }

  findEligibleMenuProduct(storeId: string, productId: string) {
    return this.db
      .prepare(
        `SELECT p.id FROM products p
         JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
           AND pv.status = 'ACTIVE' AND pv.prompt_price = 0 AND pv.sale_price IS NOT NULL
         WHERE p.store_id = ? AND p.id = ? AND p.status = 'ACTIVE' AND p.is_system = 0
           AND p.product_type IN ('QUANTITY', 'WEIGHT')
         LIMIT 1`,
      )
      .bind(storeId, productId)
      .first<{ id: string }>();
  }

  setMenuProductEnabled(storeId: string, productId: string, enabled: boolean, now: number) {
    return this.db
      .prepare(
        `UPDATE product_variants SET qr_order_enabled = ?, updated_at = ?
         WHERE store_id = ? AND product_id = ?`,
      )
      .bind(enabled ? 1 : 0, now, storeId, productId)
      .run();
  }

  findEligibleMenuVariant(storeId: string, variantId: string) {
    return this.db
      .prepare(
        `SELECT pv.id, pv.product_id AS productId FROM product_variants pv
         JOIN products p ON p.id = pv.product_id AND p.store_id = pv.store_id
         WHERE pv.store_id = ? AND pv.id = ? AND pv.status = 'ACTIVE'
           AND pv.prompt_price = 0 AND pv.sale_price IS NOT NULL
           AND p.status = 'ACTIVE' AND p.is_system = 0
           AND p.product_type IN ('QUANTITY', 'WEIGHT')
         LIMIT 1`,
      )
      .bind(storeId, variantId)
      .first<{ id: string; productId: string }>();
  }

  setMenuVariantEnabled(storeId: string, variantId: string, enabled: boolean, now: number) {
    return this.db
      .prepare(
        `UPDATE product_variants SET qr_order_enabled = ?, updated_at = ?
         WHERE store_id = ? AND id = ?`,
      )
      .bind(enabled ? 1 : 0, now, storeId, variantId)
      .run();
  }

  findQuickReason(storeId: string, reasonId: string) {
    return this.db
      .prepare(
        `SELECT id, label FROM qr_order_quick_reasons
         WHERE store_id = ? AND id = ? AND status = 'ACTIVE' LIMIT 1`,
      )
      .bind(storeId, reasonId)
      .first<{ id: string; label: string }>();
  }

  async replaceQuickReasons(storeId: string, reasons: QuickReasonInput[], now: number) {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE qr_order_quick_reasons
           SET status = 'DISABLED', archived = 1,
               label = substr(label, 1, 40) || ' [archived ' || substr(id, -8) || ']',
               updated_at = ?
           WHERE store_id = ? AND archived = 0`,
        )
        .bind(now, storeId),
      ...reasons.map((reason, index) =>
        reason.id
          ? this.db
              .prepare(
                `UPDATE qr_order_quick_reasons
                 SET label = ?, status = ?, archived = 0, sort_order = ?, updated_at = ?
                 WHERE id = ? AND store_id = ?`,
              )
              .bind(
                reason.label,
                reason.enabled ? 'ACTIVE' : 'DISABLED',
                index,
                now,
                reason.id,
                storeId,
              )
          : this.db
              .prepare(
                `INSERT INTO qr_order_quick_reasons (
                   id, store_id, label, status, archived, sort_order, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
              )
              .bind(
                crypto.randomUUID(),
                storeId,
                reason.label,
                reason.enabled ? 'ACTIVE' : 'DISABLED',
                index,
                now,
                now,
              ),
      ),
    ];
    await this.db.batch(statements);
  }
}
