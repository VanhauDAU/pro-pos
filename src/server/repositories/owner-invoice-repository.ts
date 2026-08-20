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
  status: 'PAID' | 'CANCELLED';
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
    // Build WHERE clauses for DINE_IN invoices
    const dineInWhere: string[] = ['i.store_id = ?'];
    const dineInParams: (string | number)[] = [filter.storeId];

    const takeawayWhere: string[] = ['i.store_id = ?'];
    const takeawayParams: (string | number)[] = [filter.storeId];

    // Status filter
    if (filter.status === 'PAID') {
      dineInWhere.push(`i.status = 'COMPLETED'`);
      takeawayWhere.push(`i.status = 'COMPLETED'`);
    } else if (filter.status === 'CANCELLED') {
      dineInWhere.push(`i.status = 'CANCELLED'`);
      takeawayWhere.push(`i.status = 'CANCELLED'`);
    }

    // Method filter — join payments table
    // We'll handle method via joining later

    // Date range filter
    if (filter.dateFrom) {
      const fromMs = new Date(filter.dateFrom).getTime();
      dineInWhere.push('i.issued_at >= ?');
      dineInParams.push(fromMs);
      takeawayWhere.push('i.issued_at >= ?');
      takeawayParams.push(fromMs);
    }
    if (filter.dateTo) {
      const toMs = new Date(filter.dateTo).getTime() + 86_400_000 - 1; // end of day
      dineInWhere.push('i.issued_at <= ?');
      dineInParams.push(toMs);
      takeawayWhere.push('i.issued_at <= ?');
      takeawayParams.push(toMs);
    }

    // Search: match displayCode prefix
    if (filter.search) {
      dineInWhere.push('i.display_code LIKE ?');
      dineInParams.push(`%${filter.search}%`);
      takeawayWhere.push('i.display_code LIKE ?');
      takeawayParams.push(`%${filter.search}%`);
    }

    const offset = (filter.page - 1) * filter.limit;

    // Build the queries
    const dineInSelect = `
      SELECT i.id, i.order_id AS orderId,
             i.display_code AS displayCode,
             i.subtotal, i.discount_total AS discountTotal, i.total,
             i.status, i.issued_at AS issuedAt,
             'DINE_IN' AS orderType,
             p.method, p.cash_received AS cashReceived, p.cash_change AS cashChange,
             u.display_name AS actorName,
             t.name AS tableName,
             a.name AS areaName
      FROM invoices i
      LEFT JOIN payments p ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
      LEFT JOIN users u ON u.id = i.actor_user_id
      LEFT JOIN orders o ON o.id = i.order_id AND o.store_id = i.store_id
      LEFT JOIN tables t ON t.id = o.table_id
      LEFT JOIN areas a ON a.id = t.area_id
      WHERE ${dineInWhere.join(' AND ')}
    `;

    const takeawaySelect = `
      SELECT i.id, i.order_id AS orderId,
             i.display_code AS displayCode,
             i.subtotal, i.discount_total AS discountTotal, i.total,
             i.status, i.issued_at AS issuedAt,
             'TAKEAWAY' AS orderType,
             p.method, p.cash_received AS cashReceived, p.cash_change AS cashChange,
             u.display_name AS actorName,
             NULL AS tableName,
             NULL AS areaName
      FROM takeaway_invoices i
      LEFT JOIN takeaway_payments p ON p.store_id = i.store_id AND p.order_id = i.order_id AND p.status = 'SUCCEEDED'
      LEFT JOIN users u ON u.id = i.actor_user_id
      WHERE ${takeawayWhere.join(' AND ')}
    `;

    // Method filter post-union (applied as outer filter)
    let methodFilter = '';
    let methodParam: string | null = null;
    if (filter.method) {
      methodFilter = 'WHERE method = ?';
      methodParam = filter.method;
    }

    // OrderType filter
    let orderTypeFilter = '';
    let orderTypeParam: string | null = null;
    if (filter.orderType) {
      orderTypeFilter =
        filter.orderType === 'DINE_IN'
          ? "WHERE orderType = 'DINE_IN'"
          : "WHERE orderType = 'TAKEAWAY'";
    }

    // Combine filters
    let outerWhere = '';
    const outerFilters: string[] = [];
    if (methodFilter) outerFilters.push(methodFilter.replace('WHERE ', ''));
    if (orderTypeFilter) outerFilters.push(orderTypeFilter.replace('WHERE ', ''));
    if (outerFilters.length) outerWhere = `WHERE ${outerFilters.join(' AND ')}`;

    const outerParams: (string | number)[] = [];
    if (methodParam) outerParams.push(methodParam);
    if (orderTypeParam) outerParams.push(orderTypeParam);

    // Build union query
    let unionQuery = '';
    let countQuery = '';
    let allParams: (string | number)[] = [];
    let countParams: (string | number)[] = [];

    if (filter.orderType === 'DINE_IN') {
      unionQuery = `SELECT * FROM (${dineInSelect}) sub ${outerWhere} ORDER BY issuedAt DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) AS total FROM (${dineInSelect}) sub ${outerWhere}`;
      allParams = [...dineInParams, ...outerParams, filter.limit, offset];
      countParams = [...dineInParams, ...outerParams];
    } else if (filter.orderType === 'TAKEAWAY') {
      unionQuery = `SELECT * FROM (${takeawaySelect}) sub ${outerWhere} ORDER BY issuedAt DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) AS total FROM (${takeawaySelect}) sub ${outerWhere}`;
      allParams = [...takeawayParams, ...outerParams, filter.limit, offset];
      countParams = [...takeawayParams, ...outerParams];
    } else {
      unionQuery = `
        SELECT * FROM (
          ${dineInSelect}
          UNION ALL
          ${takeawaySelect}
        ) sub ${outerWhere} ORDER BY issuedAt DESC LIMIT ? OFFSET ?
      `;
      countQuery = `
        SELECT COUNT(*) AS total FROM (
          ${dineInSelect}
          UNION ALL
          ${takeawaySelect}
        ) sub ${outerWhere}
      `;
      allParams = [...dineInParams, ...takeawayParams, ...outerParams, filter.limit, offset];
      countParams = [...dineInParams, ...takeawayParams, ...outerParams];
    }

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
