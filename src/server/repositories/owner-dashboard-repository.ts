// D1Database is globally available from Cloudflare Worker types

export interface RawInvoiceRow {
  id: string;
  orderId: string;
  displayCode: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  issuedAt: number;
  issuedBy: string;
  actorName: string | null;
  method: string | null;
  orderType: 'DINE_IN' | 'TAKEAWAY';
}

export interface RawLineItemRow {
  invoiceId: string;
  lineType: string;
  description: string;
  quantityMilli: number;
  grossLineTotal: number;
  lineTotal: number;
  productId: string | null;
  productName: string | null;
  unitName: string | null;
  categoryId: string | null;
  categoryName: string;
}

export class OwnerDashboardRepository {
  constructor(private readonly db: D1Database) {}

  async getStoreSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT
           s.timezone,
           COALESCE(ss.business_day_cutoff_minutes, 0) AS businessDayCutoffMinutes
         FROM stores s
         LEFT JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ?`,
      )
      .bind(storeId)
      .first<{ timezone: string; businessDayCutoffMinutes: number }>();
  }

  async countActiveCustomers(storeId: string) {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM customers WHERE store_id = ? AND status = 'ACTIVE'")
      .bind(storeId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async getCompletedInvoices(
    storeId: string,
    fromMs: number,
    toMs: number,
  ): Promise<RawInvoiceRow[]> {
    const query = `
      SELECT
        i.id,
        i.order_id AS orderId,
        i.display_code AS displayCode,
        i.subtotal,
        i.discount_total AS discountTotal,
        i.total,
        i.issued_at AS issuedAt,
        i.issued_by AS issuedBy,
        u.display_name AS actorName,
        p.method,
        'DINE_IN' AS orderType
      FROM invoices i
      LEFT JOIN payments p ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
      LEFT JOIN users u ON u.id = i.issued_by
      WHERE i.store_id = ? AND i.status = 'COMPLETED' AND i.issued_at >= ? AND i.issued_at <= ?

      UNION ALL

      SELECT
        i.id,
        i.order_id AS orderId,
        i.display_code AS displayCode,
        i.subtotal,
        i.discount_total AS discountTotal,
        i.total,
        i.issued_at AS issuedAt,
        i.issued_by AS issuedBy,
        u.display_name AS actorName,
        p.method,
        'TAKEAWAY' AS orderType
      FROM takeaway_invoices i
      LEFT JOIN takeaway_payments p ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
      LEFT JOIN users u ON u.id = i.issued_by
      WHERE i.store_id = ? AND i.status = 'COMPLETED' AND i.issued_at >= ? AND i.issued_at <= ?

      ORDER BY issuedAt ASC
    `;

    const res = await this.db
      .prepare(query)
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawInvoiceRow>();

    return res.results ?? [];
  }

  async getInvoiceLines(storeId: string, fromMs: number, toMs: number): Promise<RawLineItemRow[]> {
    const query = `
      SELECT
        il.invoice_id AS invoiceId,
        il.line_type AS lineType,
        il.description,
        il.quantity_milli AS quantityMilli,
        il.gross_line_total AS grossLineTotal,
        il.line_total AS lineTotal,
        json_extract(il.snapshot_json, '$.productId') AS productId,
        json_extract(il.snapshot_json, '$.productName') AS productName,
        json_extract(il.snapshot_json, '$.unitName') AS unitName,
        p.category_id AS categoryId,
        COALESCE(c.name, 'Chưa phân loại') AS categoryName
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id AND i.store_id = il.store_id
      LEFT JOIN products p ON p.id = json_extract(il.snapshot_json, '$.productId') AND p.store_id = il.store_id
      LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = il.store_id
      WHERE il.store_id = ? AND i.status = 'COMPLETED' AND i.issued_at >= ? AND i.issued_at <= ?

      UNION ALL

      SELECT
        ti.id AS invoiceId,
        til.line_type AS lineType,
        til.description,
        til.quantity_milli AS quantityMilli,
        til.gross_line_total AS grossLineTotal,
        til.line_total AS lineTotal,
        json_extract(til.snapshot_json, '$.productId') AS productId,
        COALESCE(json_extract(til.snapshot_json, '$.productName'), til.description) AS productName,
        json_extract(til.snapshot_json, '$.unitName') AS unitName,
        p.category_id AS categoryId,
        COALESCE(c.name, 'Chưa phân loại') AS categoryName
      FROM takeaway_invoice_lines til
      JOIN takeaway_invoices ti ON ti.id = til.invoice_id AND ti.store_id = til.store_id
      LEFT JOIN products p ON p.id = json_extract(til.snapshot_json, '$.productId') AND p.store_id = til.store_id
      LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = til.store_id
      WHERE til.store_id = ? AND ti.status = 'COMPLETED' AND ti.issued_at >= ? AND ti.issued_at <= ?
    `;

    const res = await this.db
      .prepare(query)
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawLineItemRow>();

    return res.results ?? [];
  }

  async getStaffUsers(storeId: string) {
    const query = `
      SELECT
        u.id AS userId,
        u.display_name AS displayName,
        r.name AS roleName
      FROM users u
      JOIN store_memberships sm ON sm.user_id = u.id AND sm.store_id = ?
      LEFT JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
    `;

    const res = await this.db.prepare(query).bind(storeId).all<{
      userId: string;
      displayName: string;
      roleName: string | null;
    }>();

    return res.results ?? [];
  }
}
