// D1Database is globally available from Cloudflare Worker types

interface InvoiceFilter {
  storeId: string;
  status?: 'PAID' | 'CANCELLED' | undefined;
  search: string;
  orderType?: 'DINE_IN' | 'TAKEAWAY' | undefined;
  method?: 'CASH' | 'BANK_TRANSFER' | undefined;
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  limit: number;
}

export interface InvoiceRow {
  id: string;
  orderId: string;
  displayCode: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  status: 'COMPLETED' | 'CANCELLED';
  issuedAt: number;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  method: string | null;
  cashReceived: number | null;
  cashChange: number | null;
  actorName: string | null;
  tableName: string | null;
  areaName: string | null;
}

export class OwnerInvoiceRepository {
  constructor(private readonly db: D1Database) {}

  async listInvoices(filter: InvoiceFilter) {
    const queries: { sql: string; params: (string | number)[] }[] = [];

    // Helper for date params
    const fromMs = filter.dateFrom ? new Date(filter.dateFrom).getTime() : null;
    const toMs = filter.dateTo ? new Date(filter.dateTo).getTime() + 86_400_000 - 1 : null;

    const includePaid = filter.status === 'PAID' || !filter.status;
    const includeCancelled = filter.status === 'CANCELLED' || !filter.status;
    const includeDineIn = filter.orderType === 'DINE_IN' || !filter.orderType;
    const includeTakeaway = filter.orderType === 'TAKEAWAY' || !filter.orderType;

    // 1. DINE_IN PAID Invoices
    if (includePaid && includeDineIn) {
      const where = ['i.store_id = ?', `i.status = 'COMPLETED'`];
      const params: (string | number)[] = [filter.storeId];

      if (fromMs !== null) {
        where.push('i.issued_at >= ?');
        params.push(fromMs);
      }
      if (toMs !== null) {
        where.push('i.issued_at <= ?');
        params.push(toMs);
      }
      if (filter.search) {
        where.push('i.display_code LIKE ?');
        params.push(`%${filter.search}%`);
      }

      queries.push({
        sql: `
          SELECT i.id, i.order_id AS orderId,
                 COALESCE(i.display_code, o.display_code, 'H' || strftime('%y%m%d', i.issued_at / 1000, 'unixepoch') || '-' || substr(i.id, 1, 4)) AS displayCode,
                 i.subtotal, i.discount_total AS discountTotal, i.total,
                 i.status, i.issued_at AS issuedAt,
                 'DINE_IN' AS orderType,
                 p.method, p.cash_received AS cashReceived, p.cash_change AS cashChange,
                 u.display_name AS actorName,
                 COALESCE(st.display_name, st.name) AS tableName,
                 a.name AS areaName
          FROM invoices i
          LEFT JOIN payments p ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
          LEFT JOIN users u ON u.id = i.issued_by
          LEFT JOIN orders o ON o.id = i.order_id AND o.store_id = i.store_id
          LEFT JOIN service_tables st ON st.id = o.table_id
          LEFT JOIN areas a ON a.id = st.area_id
          WHERE ${where.join(' AND ')}
        `,
        params,
      });
    }

    // 2. TAKEAWAY PAID Invoices
    if (includePaid && includeTakeaway) {
      const where = ['i.store_id = ?', `i.status = 'COMPLETED'`];
      const params: (string | number)[] = [filter.storeId];

      if (fromMs !== null) {
        where.push('i.issued_at >= ?');
        params.push(fromMs);
      }
      if (toMs !== null) {
        where.push('i.issued_at <= ?');
        params.push(toMs);
      }
      if (filter.search) {
        where.push('i.display_code LIKE ?');
        params.push(`%${filter.search}%`);
      }

      queries.push({
        sql: `
          SELECT i.id, i.order_id AS orderId,
                 COALESCE(i.display_code, 'H' || strftime('%y%m%d', i.issued_at / 1000, 'unixepoch') || '-' || substr(i.id, 1, 4)) AS displayCode,
                 i.subtotal, i.discount_total AS discountTotal, i.total,
                 i.status, i.issued_at AS issuedAt,
                 'TAKEAWAY' AS orderType,
                 p.method, p.cash_received AS cashReceived, p.cash_change AS cashChange,
                 u.display_name AS actorName,
                 NULL AS tableName,
                 NULL AS areaName
          FROM takeaway_invoices i
          LEFT JOIN takeaway_payments p ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
          LEFT JOIN users u ON u.id = i.issued_by
          WHERE ${where.join(' AND ')}
        `,
        params,
      });
    }

    // 3. DINE_IN CANCELLED Orders
    if (includeCancelled && includeDineIn) {
      const where = ['o.store_id = ?', `o.status = 'CANCELLED'`];
      const params: (string | number)[] = [filter.storeId];

      if (fromMs !== null) {
        where.push('COALESCE(o.cancelled_at, o.updated_at, o.opened_at) >= ?');
        params.push(fromMs);
      }
      if (toMs !== null) {
        where.push('COALESCE(o.cancelled_at, o.updated_at, o.opened_at) <= ?');
        params.push(toMs);
      }
      if (filter.search) {
        where.push('o.display_code LIKE ?');
        params.push(`%${filter.search}%`);
      }

      queries.push({
        sql: `
          SELECT o.id, o.id AS orderId,
                 COALESCE(o.display_code, 'D' || strftime('%y%m%d', o.opened_at / 1000, 'unixepoch') || '-' || substr(o.id, 1, 4)) AS displayCode,
                 COALESCE((SELECT SUM(line_total) FROM order_items WHERE store_id = o.store_id AND order_id = o.id), 0) AS subtotal,
                 COALESCE((SELECT SUM(discount_value) FROM order_items WHERE store_id = o.store_id AND order_id = o.id), 0) AS discountTotal,
                 COALESCE((SELECT SUM(line_total) FROM order_items WHERE store_id = o.store_id AND order_id = o.id), 0) AS total,
                 'CANCELLED' AS status,
                 COALESCE(o.cancelled_at, o.updated_at, o.opened_at) AS issuedAt,
                 'DINE_IN' AS orderType,
                 NULL AS method,
                 NULL AS cashReceived,
                 NULL AS cashChange,
                 COALESCE(u_cancel.display_name, u_open.display_name) AS actorName,
                 COALESCE(st.display_name, st.name) AS tableName,
                 a.name AS areaName
          FROM orders o
          LEFT JOIN service_tables st ON st.id = o.table_id
          LEFT JOIN areas a ON a.id = st.area_id
          LEFT JOIN cancel_order_commands coc ON coc.store_id = o.store_id AND coc.order_id = o.id
          LEFT JOIN users u_cancel ON u_cancel.id = coc.actor_user_id
          LEFT JOIN users u_open ON u_open.id = o.opened_by
          WHERE ${where.join(' AND ')}
        `,
        params,
      });
    }

    // 4. TAKEAWAY CANCELLED Orders
    if (includeCancelled && includeTakeaway) {
      const where = ['o.store_id = ?', `o.status = 'CANCELLED'`];
      const params: (string | number)[] = [filter.storeId];

      if (fromMs !== null) {
        where.push('COALESCE(o.cancelled_at, o.updated_at, o.opened_at) >= ?');
        params.push(fromMs);
      }
      if (toMs !== null) {
        where.push('COALESCE(o.cancelled_at, o.updated_at, o.opened_at) <= ?');
        params.push(toMs);
      }
      if (filter.search) {
        where.push('o.display_code LIKE ?');
        params.push(`%${filter.search}%`);
      }

      queries.push({
        sql: `
          SELECT o.id, o.id AS orderId,
                 COALESCE(o.display_code, 'D' || strftime('%y%m%d', o.opened_at / 1000, 'unixepoch') || '-' || substr(o.id, 1, 4)) AS displayCode,
                 COALESCE((SELECT SUM(gross_line_total) FROM takeaway_order_items WHERE store_id = o.store_id AND order_id = o.id), 0) AS subtotal,
                 COALESCE((SELECT SUM(discount_amount) FROM takeaway_order_items WHERE store_id = o.store_id AND order_id = o.id), 0) AS discountTotal,
                 COALESCE((SELECT SUM(net_line_total) FROM takeaway_order_items WHERE store_id = o.store_id AND order_id = o.id), 0) AS total,
                 'CANCELLED' AS status,
                 COALESCE(o.cancelled_at, o.updated_at, o.opened_at) AS issuedAt,
                 'TAKEAWAY' AS orderType,
                 NULL AS method,
                 NULL AS cashReceived,
                 NULL AS cashChange,
                 COALESCE(u_cancel.display_name, u_open.display_name) AS actorName,
                 NULL AS tableName,
                 NULL AS areaName
          FROM takeaway_orders o
          LEFT JOIN cancel_takeaway_order_commands coc ON coc.store_id = o.store_id AND coc.order_id = o.id
          LEFT JOIN users u_cancel ON u_cancel.id = coc.actor_user_id
          LEFT JOIN users u_open ON u_open.id = o.opened_by
          WHERE ${where.join(' AND ')}
        `,
        params,
      });
    }

    if (queries.length === 0) {
      return {
        results: [],
        total: 0,
      };
    }

    // Outer filter for method (e.g. CASH / BANK_TRANSFER)
    const outerFilters: string[] = [];
    const outerParams: (string | number)[] = [];
    if (filter.method) {
      outerFilters.push('method = ?');
      outerParams.push(filter.method);
    }
    const outerWhere = outerFilters.length ? `WHERE ${outerFilters.join(' AND ')}` : '';

    const combinedSql = queries.map((q) => q.sql).join(' UNION ALL ');
    const combinedParams = queries.flatMap((q) => q.params);

    const offset = (filter.page - 1) * filter.limit;

    const baseQuery = `SELECT * FROM (${combinedSql}) sub ${outerWhere}`;
    const unionQuery = `${baseQuery} ORDER BY issuedAt DESC LIMIT ? OFFSET ?`;
    const countQuery = `SELECT COUNT(*) AS total FROM (${combinedSql}) sub ${outerWhere}`;

    const allParams = [...combinedParams, ...outerParams, filter.limit, offset];
    const countParams = [...combinedParams, ...outerParams];

    const [rows, countResult] = await Promise.all([
      this.db
        .prepare(unionQuery)
        .bind(...allParams)
        .all<InvoiceRow>(),
      this.db
        .prepare(countQuery)
        .bind(...countParams)
        .first<{ total: number }>(),
    ]);

    return {
      results: rows.results,
      total: countResult?.total ?? 0,
    };
  }
}
