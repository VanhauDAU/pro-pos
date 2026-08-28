export interface RawReportLineRow {
  lineId: string;
  invoiceId: string;
  referenceCode: string;
  issuedAt: number;
  lineType: string;
  productId: string;
  productCode: string;
  productName: string;
  unitName: string | null;
  categoryId: string | null;
  categoryName: string;
  quantityMilli: number;
  unitPrice: number;
  grossLineTotal: number;
  discountValue: number;
  lineTotal: number;
  invoiceDiscountTotal: number;
  orderType: 'DINE_IN' | 'TAKEAWAY';
}

export interface RawCancelledItemRow {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  unitName: string | null;
  categoryId: string | null;
  categoryName: string;
  quantityMilli: number;
  lineTotal: number;
  cancelReason: string;
  cancelledAt: number;
  cancelledByName: string;
  orderType: 'DINE_IN' | 'TAKEAWAY';
}

const REPORT_LINES_QUERY = `
  WITH report_lines AS (
    SELECT
      il.id AS lineId,
      il.invoice_id AS invoiceId,
      i.display_code AS referenceCode,
      i.issued_at AS issuedAt,
      COALESCE(il.line_type, 'PRODUCT') AS lineType,
      COALESCE(
        json_extract(il.snapshot_json, '$.productId'),
        json_extract(il.snapshot_json, '$.product_id'),
        p.id,
        'legacy:' || il.id
      ) AS productId,
      COALESCE(pv.display_code, substr(COALESCE(p.id, il.id), 1, 8), 'SP') AS productCode,
      COALESCE(
        json_extract(il.snapshot_json, '$.productName'),
        json_extract(il.snapshot_json, '$.product_name'),
        il.description,
        'Mặt hàng'
      ) AS productName,
      COALESCE(
        json_extract(il.snapshot_json, '$.unitName'),
        json_extract(il.snapshot_json, '$.unit_name'),
        u.name,
        'Món'
      ) AS unitName,
      COALESCE(
        json_extract(il.snapshot_json, '$.categoryId'),
        json_extract(il.snapshot_json, '$.category_id'),
        p.category_id
      ) AS categoryId,
      COALESCE(
        json_extract(il.snapshot_json, '$.categoryName'),
        json_extract(il.snapshot_json, '$.category_name'),
        c.name,
        'Chưa phân loại'
      ) AS categoryName,
      il.quantity_milli AS quantityMilli,
      il.unit_price AS unitPrice,
      il.gross_line_total AS grossLineTotal,
      il.discount_amount AS discountValue,
      il.line_total AS lineTotal,
      i.discount_total AS invoiceDiscountTotal,
      'DINE_IN' AS orderType
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.store_id = il.store_id
    LEFT JOIN products p ON p.id = COALESCE(
      json_extract(il.snapshot_json, '$.productId'),
      json_extract(il.snapshot_json, '$.product_id')
    ) AND p.store_id = il.store_id
    LEFT JOIN product_variants pv ON pv.id = COALESCE(
      json_extract(il.snapshot_json, '$.variantId'),
      json_extract(il.snapshot_json, '$.variant_id')
    ) AND pv.store_id = il.store_id
    LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = il.store_id
    LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = il.store_id
    WHERE il.store_id = ?
      AND i.status = 'COMPLETED'
      AND i.issued_at >= ? AND i.issued_at <= ?

    UNION ALL

    SELECT
      il.id AS lineId,
      il.invoice_id AS invoiceId,
      i.display_code AS referenceCode,
      i.issued_at AS issuedAt,
      'PRODUCT' AS lineType,
      COALESCE(
        json_extract(il.snapshot_json, '$.productId'),
        json_extract(il.snapshot_json, '$.product_id'),
        p.id,
        'legacy:' || il.id
      ) AS productId,
      COALESCE(pv.display_code, substr(COALESCE(p.id, il.id), 1, 8), 'SP') AS productCode,
      COALESCE(
        json_extract(il.snapshot_json, '$.productName'),
        json_extract(il.snapshot_json, '$.product_name'),
        il.description,
        'Mặt hàng'
      ) AS productName,
      COALESCE(
        json_extract(il.snapshot_json, '$.unitName'),
        json_extract(il.snapshot_json, '$.unit_name'),
        u.name,
        'Món'
      ) AS unitName,
      COALESCE(
        json_extract(il.snapshot_json, '$.categoryId'),
        json_extract(il.snapshot_json, '$.category_id'),
        p.category_id
      ) AS categoryId,
      COALESCE(
        json_extract(il.snapshot_json, '$.categoryName'),
        json_extract(il.snapshot_json, '$.category_name'),
        c.name,
        'Chưa phân loại'
      ) AS categoryName,
      il.quantity_milli AS quantityMilli,
      il.unit_price AS unitPrice,
      il.gross_line_total AS grossLineTotal,
      il.discount_amount AS discountValue,
      il.line_total AS lineTotal,
      i.discount_total AS invoiceDiscountTotal,
      'TAKEAWAY' AS orderType
    FROM takeaway_invoice_lines il
    JOIN takeaway_invoices i ON i.id = il.invoice_id AND i.store_id = il.store_id
    LEFT JOIN products p ON p.id = COALESCE(
      json_extract(il.snapshot_json, '$.productId'),
      json_extract(il.snapshot_json, '$.product_id')
    ) AND p.store_id = il.store_id
    LEFT JOIN product_variants pv ON pv.id = COALESCE(
      json_extract(il.snapshot_json, '$.variantId'),
      json_extract(il.snapshot_json, '$.variant_id')
    ) AND pv.store_id = il.store_id
    LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = il.store_id
    LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = il.store_id
    WHERE il.store_id = ?
      AND i.status = 'COMPLETED'
      AND i.issued_at >= ? AND i.issued_at <= ?
  )
`;

export class OwnerProductReportRepository {
  constructor(private readonly db: D1Database) {}

  async getInvoiceLineItems(
    storeId: string,
    fromMs: number,
    toMs: number,
  ): Promise<RawReportLineRow[]> {
    const result = await this.db
      .prepare(`${REPORT_LINES_QUERY} SELECT * FROM report_lines ORDER BY issuedAt ASC, lineId ASC`)
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawReportLineRow>();

    return result.results;
  }

  async getCancelledItems(
    storeId: string,
    fromMs: number,
    toMs: number,
  ): Promise<RawCancelledItemRow[]> {
    const result = await this.db
      .prepare(
        `SELECT
          oi.id,
          o.id AS orderId,
          oi.product_id AS productId,
          oi.product_name_snapshot AS productName,
          COALESCE(oi.unit_name_snapshot, 'Món') AS unitName,
          p.category_id AS categoryId,
          COALESCE(c.name, 'Chưa phân loại') AS categoryName,
          oi.quantity_milli AS quantityMilli,
          oi.net_line_total AS lineTotal,
          COALESCE(o.cancel_reason, 'Không có lý do') AS cancelReason,
          COALESCE(o.cancelled_at, o.updated_at) AS cancelledAt,
          COALESCE(u.display_name, 'Nhân viên') AS cancelledByName,
          'DINE_IN' AS orderType
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
        LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = oi.store_id
        LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = oi.store_id
        LEFT JOIN cancel_order_commands command
          ON command.order_id = o.id AND command.store_id = o.store_id
        LEFT JOIN users u ON u.id = command.actor_user_id
        WHERE o.store_id = ? AND o.status = 'CANCELLED'
          AND COALESCE(o.cancelled_at, o.updated_at) >= ?
          AND COALESCE(o.cancelled_at, o.updated_at) <= ?
          AND oi.product_type != 'TIME'

        UNION ALL

        SELECT
          oi.id,
          o.id AS orderId,
          oi.product_id AS productId,
          oi.product_name_snapshot AS productName,
          COALESCE(oi.unit_name_snapshot, 'Món') AS unitName,
          p.category_id AS categoryId,
          COALESCE(c.name, 'Chưa phân loại') AS categoryName,
          oi.quantity_milli AS quantityMilli,
          oi.net_line_total AS lineTotal,
          COALESCE(o.cancel_reason, 'Không có lý do') AS cancelReason,
          COALESCE(o.cancelled_at, o.updated_at) AS cancelledAt,
          COALESCE(u.display_name, 'Nhân viên') AS cancelledByName,
          'TAKEAWAY' AS orderType
        FROM takeaway_order_items oi
        JOIN takeaway_orders o ON o.id = oi.order_id AND o.store_id = oi.store_id
        LEFT JOIN products p ON p.id = oi.product_id AND p.store_id = oi.store_id
        LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = oi.store_id
        LEFT JOIN cancel_takeaway_order_commands command
          ON command.order_id = o.id AND command.store_id = o.store_id
        LEFT JOIN users u ON u.id = command.actor_user_id
        WHERE o.store_id = ? AND o.status = 'CANCELLED'
          AND COALESCE(o.cancelled_at, o.updated_at) >= ?
          AND COALESCE(o.cancelled_at, o.updated_at) <= ?

        ORDER BY cancelledAt DESC`,
      )
      .bind(storeId, fromMs, toMs, storeId, fromMs, toMs)
      .all<RawCancelledItemRow>();

    return result.results;
  }
}
