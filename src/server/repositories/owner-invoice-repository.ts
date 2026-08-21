// D1Database is globally available from Cloudflare Worker types
import { AppError } from '@server/lib/app-error';

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

  async deleteInvoice(
    storeId: string,
    targetId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<{ deleted: boolean; orderId: string; displayCode: string }> {
    const dineInInvoice = await this.db
      .prepare(
        `SELECT i.id AS invoiceId, i.order_id AS orderId, i.display_code AS displayCode,
                o.version, o.table_id AS tableId
         FROM invoices i
         JOIN orders o ON o.id = i.order_id AND o.store_id = i.store_id
         WHERE i.store_id = ? AND (i.id = ? OR i.order_id = ?)`,
      )
      .bind(storeId, targetId, targetId)
      .first<{
        invoiceId: string;
        orderId: string;
        displayCode: string;
        version: number;
        tableId: string;
      }>();

    if (dineInInvoice) {
      await this.deleteDineIn({ storeId, actorUserId, requestId, ...dineInInvoice });
      return {
        deleted: true,
        orderId: dineInInvoice.orderId,
        displayCode: dineInInvoice.displayCode,
      };
    }

    const takeawayInvoice = await this.db
      .prepare(
        `SELECT i.id AS invoiceId, i.order_id AS orderId, i.display_code AS displayCode,
                o.version
         FROM takeaway_invoices i
         JOIN takeaway_orders o ON o.id = i.order_id AND o.store_id = i.store_id
         WHERE i.store_id = ? AND (i.id = ? OR i.order_id = ?)`,
      )
      .bind(storeId, targetId, targetId)
      .first<{ invoiceId: string; orderId: string; displayCode: string; version: number }>();

    if (takeawayInvoice) {
      await this.deleteTakeaway({ storeId, actorUserId, requestId, ...takeawayInvoice });
      return {
        deleted: true,
        orderId: takeawayInvoice.orderId,
        displayCode: takeawayInvoice.displayCode,
      };
    }

    const dineInOrder = await this.db
      .prepare(
        `SELECT id AS orderId, display_code AS displayCode, version, table_id AS tableId
         FROM orders WHERE store_id = ? AND id = ?`,
      )
      .bind(storeId, targetId)
      .first<{ orderId: string; displayCode: string; version: number; tableId: string }>();

    if (dineInOrder) {
      await this.deleteDineIn({
        storeId,
        actorUserId,
        requestId,
        invoiceId: null,
        ...dineInOrder,
      });
      return { deleted: true, orderId: dineInOrder.orderId, displayCode: dineInOrder.displayCode };
    }

    const takeawayOrder = await this.db
      .prepare(
        `SELECT id AS orderId, display_code AS displayCode, version
         FROM takeaway_orders WHERE store_id = ? AND id = ?`,
      )
      .bind(storeId, targetId)
      .first<{ orderId: string; displayCode: string; version: number }>();

    if (takeawayOrder) {
      await this.deleteTakeaway({
        storeId,
        actorUserId,
        requestId,
        invoiceId: null,
        ...takeawayOrder,
      });
      return {
        deleted: true,
        orderId: takeawayOrder.orderId,
        displayCode: takeawayOrder.displayCode,
      };
    }

    throw new AppError('INVOICE_NOT_FOUND', 'Hóa đơn hoặc đơn hàng không tồn tại.', 404);
  }

  private async deleteDineIn(input: {
    storeId: string;
    orderId: string;
    invoiceId: string | null;
    displayCode: string;
    version: number;
    tableId: string;
    actorUserId: string;
    requestId: string;
  }) {
    const { storeId, orderId, invoiceId } = input;
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `DELETE FROM audit_logs
           WHERE store_id = ? AND (
             entity_id IN (?, ?)
             OR json_extract(after_json, '$.orderId') = ?
             OR json_extract(before_json, '$.orderId') = ?
             OR entity_id IN (SELECT id FROM order_items WHERE store_id = ? AND order_id = ?)
             OR entity_id IN (SELECT id FROM time_sessions WHERE store_id = ? AND order_id = ?)
             OR entity_id IN (SELECT id FROM payments WHERE store_id = ? AND order_id = ?)
           )`,
        )
        .bind(
          storeId,
          orderId,
          invoiceId,
          orderId,
          orderId,
          storeId,
          orderId,
          storeId,
          orderId,
          storeId,
          orderId,
        ),
    ];
    if (invoiceId) {
      statements.push(
        this.db
          .prepare('DELETE FROM invoice_lines WHERE store_id = ? AND invoice_id = ?')
          .bind(storeId, invoiceId),
        this.db
          .prepare('DELETE FROM invoices WHERE store_id = ? AND id = ?')
          .bind(storeId, invoiceId),
      );
    }
    statements.push(
      this.db
        .prepare(
          `DELETE FROM guest_order_request_items WHERE request_id IN (
             SELECT id FROM guest_order_requests WHERE store_id = ? AND order_id = ?
           )`,
        )
        .bind(storeId, orderId),
      this.db
        .prepare(
          `DELETE FROM accept_guest_order_request_commands WHERE store_id = ?
           AND guest_request_id IN (
             SELECT id FROM guest_order_requests WHERE store_id = ? AND order_id = ?
           )`,
        )
        .bind(storeId, storeId, orderId),
      this.db
        .prepare(
          `DELETE FROM reject_guest_order_request_commands WHERE store_id = ?
           AND guest_request_id IN (
             SELECT id FROM guest_order_requests WHERE store_id = ? AND order_id = ?
           )`,
        )
        .bind(storeId, storeId, orderId),
      this.db
        .prepare('DELETE FROM guest_order_requests WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare(
          'DELETE FROM create_guest_order_request_commands WHERE store_id = ? AND order_id = ?',
        )
        .bind(storeId, orderId),
      this.db
        .prepare('DELETE FROM service_requests WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare(
          `DELETE FROM guest_order_sessions WHERE store_id = ? AND time_session_id IN (
             SELECT id FROM time_sessions WHERE store_id = ? AND order_id = ?
           )`,
        )
        .bind(storeId, storeId, orderId),
    );
    for (const table of [
      'resume_checkout_commands',
      'checkout_commands',
      'pause_time_commands',
      'resume_time_commands',
      'stop_time_commands',
      'remove_time_session_commands',
      'create_time_session_commands',
      'update_time_range_commands',
      'transfer_table_commands',
      'add_item_commands',
      'update_order_item_commands',
      'remove_order_item_commands',
      'update_order_guest_commands',
      'update_order_note_commands',
      'cancel_order_commands',
      'open_table_commands',
    ]) {
      statements.push(
        this.db
          .prepare(`DELETE FROM ${table} WHERE store_id = ? AND order_id = ?`)
          .bind(storeId, orderId),
      );
    }
    statements.push(
      this.db
        .prepare(
          `DELETE FROM pricing_segments
           WHERE store_id = ? AND time_session_id IN (
             SELECT id FROM time_sessions WHERE store_id = ? AND order_id = ?
           )`,
        )
        .bind(storeId, storeId, orderId),
      this.db
        .prepare(
          `DELETE FROM time_pauses
           WHERE store_id = ? AND time_session_id IN (
             SELECT id FROM time_sessions WHERE store_id = ? AND order_id = ?
           )`,
        )
        .bind(storeId, storeId, orderId),
      this.db
        .prepare('DELETE FROM table_time_segments WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare('DELETE FROM payments WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare('DELETE FROM time_sessions WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare('DELETE FROM order_items WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare(
          `UPDATE service_tables SET status = 'AVAILABLE', version = version + 1, updated_at = ?
           WHERE store_id = ? AND id = ? AND status = 'OCCUPIED'`,
        )
        .bind(Date.now(), storeId, input.tableId),
      this.db.prepare('DELETE FROM orders WHERE store_id = ? AND id = ?').bind(storeId, orderId),
      this.deletionAudit(input, 'INVOICE'),
      this.deletionRealtimeEvent(input, [input.tableId]),
    );
    await this.db.batch(statements);
  }

  private async deleteTakeaway(input: {
    storeId: string;
    orderId: string;
    invoiceId: string | null;
    displayCode: string;
    version: number;
    actorUserId: string;
    requestId: string;
  }) {
    const { storeId, orderId, invoiceId } = input;
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `DELETE FROM audit_logs
           WHERE store_id = ? AND (
             entity_id IN (?, ?)
             OR json_extract(after_json, '$.orderId') = ?
             OR json_extract(before_json, '$.orderId') = ?
             OR entity_id IN (
               SELECT id FROM takeaway_order_items WHERE store_id = ? AND order_id = ?
             )
             OR entity_id IN (
               SELECT id FROM takeaway_payments WHERE store_id = ? AND order_id = ?
             )
           )`,
        )
        .bind(storeId, orderId, invoiceId, orderId, orderId, storeId, orderId, storeId, orderId),
    ];
    if (invoiceId) {
      statements.push(
        this.db
          .prepare('DELETE FROM takeaway_invoice_lines WHERE store_id = ? AND invoice_id = ?')
          .bind(storeId, invoiceId),
        this.db
          .prepare('DELETE FROM takeaway_invoices WHERE store_id = ? AND id = ?')
          .bind(storeId, invoiceId),
      );
    }
    for (const table of [
      'takeaway_checkout_commands',
      'add_takeaway_item_commands',
      'cancel_takeaway_order_commands',
      'create_takeaway_order_commands',
      'update_order_item_commands',
      'remove_order_item_commands',
      'update_order_guest_commands',
      'update_order_note_commands',
    ]) {
      statements.push(
        this.db
          .prepare(`DELETE FROM ${table} WHERE store_id = ? AND order_id = ?`)
          .bind(storeId, orderId),
      );
    }
    statements.push(
      this.db
        .prepare('DELETE FROM takeaway_payments WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare('DELETE FROM takeaway_order_items WHERE store_id = ? AND order_id = ?')
        .bind(storeId, orderId),
      this.db
        .prepare('DELETE FROM takeaway_orders WHERE store_id = ? AND id = ?')
        .bind(storeId, orderId),
      this.deletionAudit(input, 'TAKEAWAY_INVOICE'),
      this.deletionRealtimeEvent(input, []),
    );
    await this.db.batch(statements);
  }

  private deletionAudit(
    input: {
      storeId: string;
      orderId: string;
      invoiceId: string | null;
      displayCode: string;
      actorUserId: string;
      requestId: string;
    },
    entityType: 'INVOICE' | 'TAKEAWAY_INVOICE',
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, store_id, actor_user_id, action, entity_type, entity_id,
          request_id, before_json, after_json, created_at
        ) VALUES (
          lower(hex(randomblob(16))), ?, ?, 'INVOICE_DELETED', ?, ?, ?, ?, ?, ?
        )`,
      )
      .bind(
        input.storeId,
        input.actorUserId,
        entityType,
        input.invoiceId ?? input.orderId,
        input.requestId,
        JSON.stringify({
          invoiceId: input.invoiceId,
          orderId: input.orderId,
          displayCode: input.displayCode,
          orderType: entityType === 'INVOICE' ? 'DINE_IN' : 'TAKEAWAY',
        }),
        JSON.stringify({ deleted: true, hardDelete: true }),
        Date.now(),
      );
  }

  private deletionRealtimeEvent(
    input: {
      storeId: string;
      orderId: string;
      version: number;
      actorUserId: string;
      requestId: string;
    },
    affectedTableIds: string[],
  ) {
    return this.db
      .prepare(
        `INSERT INTO realtime_event_requests (
          id, store_id, event_type, order_id, order_version, actor_user_id,
          device_id, client_mutation_id, request_id, topics_json, data_json, occurred_at
        ) VALUES (?, ?, 'pos.order.closed', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.storeId,
        input.orderId,
        input.version + 1,
        input.actorUserId,
        input.requestId,
        input.requestId,
        JSON.stringify(['pos.orders', 'pos.tables', `pos.order:${input.orderId}`]),
        JSON.stringify({ reason: 'DELETED', affectedTableIds }),
        Date.now(),
      );
  }
}
