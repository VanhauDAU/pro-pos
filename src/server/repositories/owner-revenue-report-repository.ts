export interface RawRevenueInvoiceRow {
  id: string;
  issuedAt: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  method: string | null;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  issuedBy: string;
  staffName: string;
  roleName: string | null;
}

export interface RawRevenueInvoiceLineRow {
  invoiceId: string;
  issuedAt: number;
  lineType: 'PRODUCT' | 'TIME';
  quantityMilli: number;
  grossAmount: number;
}

export interface RawRevenueCancelledOrderRow {
  id: string;
  cancelledAt: number;
  total: number;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  cancelledByName: string;
  reason: string;
}

export interface RevenueReportStoreSettingsRow {
  timezone: string;
  businessDayCutoffMinutes: number;
}

export class OwnerRevenueReportRepository {
  constructor(private readonly db: D1Database) {}

  async getStoreSettings(storeId: string): Promise<RevenueReportStoreSettingsRow | null> {
    return this.db
      .prepare(
        `SELECT store.timezone,
                COALESCE(settings.business_day_cutoff_minutes, 0) AS businessDayCutoffMinutes
         FROM stores store
         LEFT JOIN store_settings settings ON settings.store_id = store.id
         WHERE store.id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first<RevenueReportStoreSettingsRow>();
  }

  async getCompletedInvoices(
    storeId: string,
    fromMs: number,
    toMs: number,
  ): Promise<RawRevenueInvoiceRow[]> {
    const result = await this.db
      .prepare(
        `SELECT i.id, i.issued_at AS issuedAt, i.subtotal,
                i.discount_total AS discountTotal, i.total, p.method,
                'DINE_IN' AS orderType, i.issued_by AS issuedBy,
                COALESCE(user.display_name, 'Nhân viên') AS staffName, role.name AS roleName
         FROM invoices i
         LEFT JOIN payments p
           ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
         LEFT JOIN users user ON user.id = i.issued_by
         LEFT JOIN store_memberships membership
           ON membership.store_id = i.store_id AND membership.user_id = i.issued_by
         LEFT JOIN roles role ON role.store_id = membership.store_id AND role.id = membership.role_id
         WHERE i.store_id = ? AND i.status = 'COMPLETED'
           AND i.issued_at >= ? AND i.issued_at <= ?

         UNION ALL

         SELECT i.id, i.issued_at AS issuedAt, i.subtotal,
                i.discount_total AS discountTotal, i.total, p.method,
                'TAKEAWAY' AS orderType, i.issued_by AS issuedBy,
                COALESCE(user.display_name, 'Nhân viên') AS staffName, role.name AS roleName
         FROM takeaway_invoices i
         LEFT JOIN takeaway_payments p
           ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
         LEFT JOIN users user ON user.id = i.issued_by
         LEFT JOIN store_memberships membership
           ON membership.store_id = i.store_id AND membership.user_id = i.issued_by
         LEFT JOIN roles role ON role.store_id = membership.store_id AND role.id = membership.role_id
         WHERE i.store_id = ? AND i.status = 'COMPLETED'
           AND i.issued_at >= ? AND i.issued_at <= ?
         ORDER BY issuedAt ASC`,
      )
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawRevenueInvoiceRow>();
    return result.results;
  }

  async getInvoiceLines(
    storeId: string,
    fromMs: number,
    toMs: number,
  ): Promise<RawRevenueInvoiceLineRow[]> {
    const result = await this.db
      .prepare(
        `SELECT il.invoice_id AS invoiceId, i.issued_at AS issuedAt,
                il.line_type AS lineType, il.quantity_milli AS quantityMilli,
                il.gross_line_total AS grossAmount
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id AND i.store_id = il.store_id
         WHERE il.store_id = ? AND i.status = 'COMPLETED'
           AND i.issued_at >= ? AND i.issued_at <= ?

         UNION ALL

         SELECT il.invoice_id AS invoiceId, i.issued_at AS issuedAt,
                il.line_type AS lineType, il.quantity_milli AS quantityMilli,
                il.gross_line_total AS grossAmount
         FROM takeaway_invoice_lines il
         JOIN takeaway_invoices i ON i.id = il.invoice_id AND i.store_id = il.store_id
         WHERE il.store_id = ? AND i.status = 'COMPLETED'
           AND i.issued_at >= ? AND i.issued_at <= ?`,
      )
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawRevenueInvoiceLineRow>();
    return result.results;
  }

  async getCancelledOrders(
    storeId: string,
    fromMs: number,
    toMs: number,
  ): Promise<RawRevenueCancelledOrderRow[]> {
    const result = await this.db
      .prepare(
        `SELECT o.id, COALESCE(o.cancelled_at, o.updated_at) AS cancelledAt,
                COALESCE((SELECT SUM(oi.line_total) FROM order_items oi
                          WHERE oi.store_id = o.store_id AND oi.order_id = o.id), 0) AS total,
                'DINE_IN' AS orderType,
                COALESCE(user.display_name, 'Nhân viên') AS cancelledByName,
                COALESCE(o.cancel_reason, 'Không có lý do') AS reason
         FROM orders o
         LEFT JOIN cancel_order_commands command
           ON command.store_id = o.store_id AND command.order_id = o.id
         LEFT JOIN users user ON user.id = command.actor_user_id
         WHERE o.store_id = ? AND o.status = 'CANCELLED'
           AND COALESCE(o.cancelled_at, o.updated_at) >= ?
           AND COALESCE(o.cancelled_at, o.updated_at) <= ?

         UNION ALL

         SELECT o.id, COALESCE(o.cancelled_at, o.updated_at) AS cancelledAt,
                COALESCE((SELECT SUM(oi.net_line_total) FROM takeaway_order_items oi
                          WHERE oi.store_id = o.store_id AND oi.order_id = o.id), 0) AS total,
                'TAKEAWAY' AS orderType,
                COALESCE(user.display_name, 'Nhân viên') AS cancelledByName,
                COALESCE(o.cancel_reason, 'Không có lý do') AS reason
         FROM takeaway_orders o
         LEFT JOIN cancel_takeaway_order_commands command
           ON command.store_id = o.store_id AND command.order_id = o.id
         LEFT JOIN users user ON user.id = command.actor_user_id
         WHERE o.store_id = ? AND o.status = 'CANCELLED'
           AND COALESCE(o.cancelled_at, o.updated_at) >= ?
           AND COALESCE(o.cancelled_at, o.updated_at) <= ?
         ORDER BY cancelledAt ASC`,
      )
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawRevenueCancelledOrderRow>();
    return result.results;
  }
}
