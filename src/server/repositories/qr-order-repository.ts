import type {
  GuestMenuProduct,
  GuestOrderRequestDto,
  ServiceRequestDto,
} from '@contracts/qr-order';

export interface QrActiveContextRow {
  qrId: string;
  storeId: string;
  storeName: string;
  tableId: string;
  tableName: string;
  areaName: string;
  timeSessionId: string;
  orderId: string;
  orderVersion: number;
}

export interface GuestSessionRow extends QrActiveContextRow {
  guestSessionId: string;
  expiresAt: number;
}

interface GuestRequestRow {
  id: string;
  status: GuestOrderRequestDto['status'];
  tableId: string;
  tableName: string;
  areaName: string;
  orderId: string;
  orderVersion: number;
  createdAt: number;
  note: string | null;
  rejectedReason: string | null;
}

export class QrOrderRepository {
  constructor(private readonly db: D1Database) {}

  findActiveQrContext(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT qr.id AS qrId, s.id AS storeId, s.name AS storeName,
                st.id AS tableId, COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, ts.id AS timeSessionId, o.id AS orderId,
                o.version AS orderVersion
         FROM table_qr_codes qr
         JOIN stores s ON s.id = qr.store_id AND s.status = 'ACTIVE'
         JOIN service_tables st ON st.id = qr.table_id AND st.store_id = qr.store_id
           AND st.status = 'OCCUPIED'
         JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id AND a.status = 'ACTIVE'
         JOIN orders o ON o.store_id = st.store_id AND o.table_id = st.id AND o.status = 'OPEN'
         JOIN time_sessions ts ON ts.store_id = o.store_id AND ts.order_id = o.id
           AND ts.table_id = st.id AND ts.status IN ('RUNNING', 'PAUSED')
         WHERE qr.token_hash = ? AND qr.enabled = 1 LIMIT 1`,
      )
      .bind(tokenHash)
      .first<QrActiveContextRow>();
  }

  findGuestSession(secretHash: string, now: number) {
    return this.db
      .prepare(
        `SELECT gs.id AS guestSessionId, gs.expires_at AS expiresAt,
                qr.id AS qrId, s.id AS storeId, s.name AS storeName,
                st.id AS tableId, COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, ts.id AS timeSessionId, o.id AS orderId,
                o.version AS orderVersion
         FROM guest_order_sessions gs
         JOIN table_qr_codes qr ON qr.id = gs.qr_code_id AND qr.enabled = 1
         JOIN stores s ON s.id = gs.store_id AND s.status = 'ACTIVE'
         JOIN service_tables st ON st.id = gs.table_id AND st.store_id = gs.store_id
         JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
         JOIN time_sessions ts ON ts.id = gs.time_session_id AND ts.store_id = gs.store_id
           AND ts.status IN ('RUNNING', 'PAUSED')
         JOIN orders o ON o.id = ts.order_id AND o.store_id = ts.store_id AND o.status = 'OPEN'
         WHERE gs.secret_hash = ? AND gs.status = 'ACTIVE' AND gs.expires_at > ? LIMIT 1`,
      )
      .bind(secretHash, now)
      .first<GuestSessionRow>();
  }

  createGuestSession(input: {
    id: string;
    secretHash: string;
    context: QrActiveContextRow;
    ipHash: string | null;
    deviceNonce: string | null;
    now: number;
    expiresAt: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO guest_order_sessions (
          id, secret_hash, store_id, table_id, time_session_id, qr_code_id,
          status, ip_hash, device_nonce, created_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.secretHash,
        input.context.storeId,
        input.context.tableId,
        input.context.timeSessionId,
        input.context.qrId,
        input.ipHash,
        input.deviceNonce,
        input.now,
        input.now,
        input.expiresAt,
      )
      .run();
  }

  touchGuestSession(id: string, now: number) {
    return this.db
      .prepare('UPDATE guest_order_sessions SET last_seen_at = ? WHERE id = ?')
      .bind(now, id)
      .run();
  }

  async listMenu(storeId: string): Promise<GuestMenuProduct[]> {
    const result = await this.db
      .prepare(
        `SELECT p.id AS productId, p.name AS productName, p.category_id AS categoryId,
                c.name AS categoryName, p.avatar_type AS avatarType,
                p.avatar_color AS avatarColor, p.media_id AS mediaId,
                u.name AS unitName, pv.id AS variantId, pv.name AS variantName,
                pv.sale_price AS salePriceVnd
         FROM products p
         JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
           AND pv.status = 'ACTIVE' AND pv.prompt_price = 0 AND pv.sale_price IS NOT NULL
         LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
         WHERE p.store_id = ? AND p.status = 'ACTIVE' AND p.is_system = 0
           AND p.product_type = 'QUANTITY'
         ORDER BY c.sort_order, p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all<{
        productId: string;
        productName: string;
        categoryId: string | null;
        categoryName: string | null;
        avatarType: 'COLOR' | 'IMAGE';
        avatarColor: string | null;
        mediaId: string | null;
        unitName: string | null;
        variantId: string;
        variantName: string;
        salePriceVnd: number;
      }>();
    const products = new Map<string, GuestMenuProduct>();
    for (const row of result.results) {
      const product = products.get(row.productId) ?? {
        id: row.productId,
        name: row.productName,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        unitName: row.unitName,
        avatarType: row.avatarType,
        avatarColor: row.avatarColor,
        mediaId: row.mediaId,
        variants: [],
      };
      product.variants.push({
        id: row.variantId,
        name: row.variantName,
        salePriceVnd: row.salePriceVnd,
      });
      products.set(row.productId, product);
    }
    return [...products.values()];
  }

  findSaleVariant(storeId: string, productId: string, variantId: string | null) {
    return this.db
      .prepare(
        `SELECT p.id AS productId, p.name AS productName, p.product_type AS productType,
                pv.id AS variantId, pv.name AS variantName, pv.sale_price AS salePriceVnd,
                u.name AS unitName
         FROM products p
         JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
           AND pv.status = 'ACTIVE' AND pv.prompt_price = 0 AND pv.sale_price IS NOT NULL
         LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
         WHERE p.store_id = ? AND p.id = ? AND p.status = 'ACTIVE'
           AND p.product_type = 'QUANTITY' AND (? IS NULL OR pv.id = ?)
         ORDER BY pv.created_at LIMIT 1`,
      )
      .bind(storeId, productId, variantId, variantId)
      .first<{
        productId: string;
        productName: string;
        productType: 'QUANTITY';
        variantId: string;
        variantName: string;
        salePriceVnd: number;
        unitName: string | null;
      }>();
  }

  findRequestByClient(guestSessionId: string, clientRequestId: string) {
    return this.db
      .prepare(
        `SELECT id FROM guest_order_requests
         WHERE guest_session_id = ? AND client_request_id = ? LIMIT 1`,
      )
      .bind(guestSessionId, clientRequestId)
      .first<{ id: string }>();
  }

  async createGuestOrder(input: {
    commandId: string;
    requestId: string;
    clientRequestId: string;
    session: GuestSessionRow;
    note: string | null;
    ipHash: string | null;
    now: number;
    items: Array<{
      id: string;
      productId: string;
      variantId: string;
      productName: string;
      variantName: string;
      unitName: string | null;
      unitPriceVnd: number;
      quantityMilli: number;
      lineTotalVnd: number;
      note: string | null;
    }>;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO create_guest_order_request_commands (
            id, store_id, guest_session_id, table_id, time_session_id, order_id,
            request_id, client_request_id, note, ip_hash, issued_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.commandId,
          input.session.storeId,
          input.session.guestSessionId,
          input.session.tableId,
          input.session.timeSessionId,
          input.session.orderId,
          input.requestId,
          input.clientRequestId,
          input.note,
          input.ipHash,
          input.now,
        ),
      ...input.items.map((item) =>
        this.db
          .prepare(
            `INSERT INTO guest_order_request_items (
              id, store_id, request_id, product_id, variant_id,
              product_name_snapshot, variant_name_snapshot, unit_name_snapshot,
              unit_price_snapshot, quantity_milli, gross_line_total, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.id,
            input.session.storeId,
            input.requestId,
            item.productId,
            item.variantId,
            item.productName,
            item.variantName,
            item.unitName,
            item.unitPriceVnd,
            item.quantityMilli,
            item.lineTotalVnd,
            item.note,
            input.now,
          ),
      ),
    ]);
  }

  async listGuestRequestsBySession(guestSessionId: string) {
    return this.listRequests('gor.guest_session_id = ?', [guestSessionId]);
  }

  async listStaffRequests(storeId: string, status?: string) {
    return this.listRequests(
      `gor.store_id = ?${status ? ' AND gor.status = ?' : ''}`,
      status ? [storeId, status] : [storeId],
    );
  }

  private async listRequests(where: string, params: string[]): Promise<GuestOrderRequestDto[]> {
    const rows = await this.db
      .prepare(
        `SELECT gor.id, gor.status, gor.table_id AS tableId,
                COALESCE(st.display_name, st.name) AS tableName, a.name AS areaName,
                gor.order_id AS orderId, o.version AS orderVersion,
                gor.created_at AS createdAt, gor.note,
                gor.rejected_reason AS rejectedReason
         FROM guest_order_requests gor
         JOIN service_tables st ON st.id = gor.table_id
         JOIN areas a ON a.id = st.area_id
         JOIN orders o ON o.id = gor.order_id
         WHERE ${where} ORDER BY gor.created_at DESC LIMIT 100`,
      )
      .bind(...params)
      .all<GuestRequestRow>();
    if (rows.results.length === 0) return [];
    const ids = rows.results.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const items = await this.db
      .prepare(
        `SELECT id, request_id AS requestId, product_name_snapshot AS productName,
                variant_name_snapshot AS variantName, quantity_milli AS quantityMilli,
                unit_price_snapshot AS unitPriceVnd, gross_line_total AS lineTotalVnd, note
         FROM guest_order_request_items WHERE request_id IN (${placeholders}) ORDER BY created_at`,
      )
      .bind(...ids)
      .all<{
        id: string;
        requestId: string;
        productName: string;
        variantName: string | null;
        quantityMilli: number;
        unitPriceVnd: number;
        lineTotalVnd: number;
        note: string | null;
      }>();
    return rows.results.map((row) =>
      Object.assign(row, {
        items: items.results
          .filter((item) => item.requestId === row.id)
          .map((item) => Object.assign(item, { quantity: item.quantityMilli / 1000 })),
      }),
    );
  }

  acceptRequest(input: {
    commandId: string;
    storeId: string;
    guestRequestId: string;
    expectedOrderVersion: number;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO accept_guest_order_request_commands (
          id, store_id, guest_request_id, expected_order_version,
          actor_user_id, actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.guestRequestId,
        input.expectedOrderVersion,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findAcceptCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT guest_request_id AS guestRequestId
         FROM accept_guest_order_request_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ guestRequestId: string }>();
  }

  rejectRequest(input: {
    commandId: string;
    storeId: string;
    guestRequestId: string;
    reason: string;
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
    requestId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO reject_guest_order_request_commands (
          id, store_id, guest_request_id, reason, actor_user_id,
          actor_session_id, device_id, request_id, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.commandId,
        input.storeId,
        input.guestRequestId,
        input.reason,
        input.actorId,
        input.actorSessionId,
        input.deviceId,
        input.requestId,
        input.now,
      )
      .run();
  }

  findRejectCommand(storeId: string, commandId: string) {
    return this.db
      .prepare(
        `SELECT guest_request_id AS guestRequestId
         FROM reject_guest_order_request_commands WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, commandId)
      .first<{ guestRequestId: string }>();
  }

  findOpenServiceRequest(timeSessionId: string, type: string, since: number) {
    return this.db
      .prepare(
        `SELECT id FROM service_requests
         WHERE time_session_id = ? AND type = ?
           AND (status IN ('OPEN', 'ACKNOWLEDGED') OR created_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(timeSessionId, type, since)
      .first<{ id: string }>();
  }

  async createServiceRequest(input: {
    id: string;
    session: GuestSessionRow;
    type: 'CALL_STAFF' | 'CHECKOUT_REQUEST';
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO service_requests (
            id, store_id, table_id, time_session_id, order_id, guest_session_id,
            type, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        )
        .bind(
          input.id,
          input.session.storeId,
          input.session.tableId,
          input.session.timeSessionId,
          input.session.orderId,
          input.session.guestSessionId,
          input.type,
          input.now,
        ),
      this.db
        .prepare(
          `INSERT INTO realtime_event_requests VALUES (
            ?, ?, 'pos.order.changed', ?, ?, NULL, NULL, ?, ?,
            json_array('guest.services'),
            json_object('reason', 'SERVICE_REQUEST_CREATED', 'serviceRequestId', ?,
              'affectedTableIds', json_array(?)), ?
          )`,
        )
        .bind(
          crypto.randomUUID(),
          input.session.storeId,
          input.session.orderId,
          input.session.orderVersion,
          input.id,
          input.id,
          input.id,
          input.session.tableId,
          input.now,
        ),
    ]);
  }

  async listServiceRequests(storeId: string): Promise<ServiceRequestDto[]> {
    const result = await this.db
      .prepare(
        `SELECT sr.id, sr.type, sr.status,
                COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, sr.created_at AS createdAt
         FROM service_requests sr
         JOIN service_tables st ON st.id = sr.table_id
         JOIN areas a ON a.id = st.area_id
         WHERE sr.store_id = ? AND sr.status IN ('OPEN', 'ACKNOWLEDGED')
         ORDER BY sr.created_at DESC`,
      )
      .bind(storeId)
      .all<ServiceRequestDto>();
    return result.results;
  }

  async updateServiceRequest(input: {
    storeId: string;
    id: string;
    action: 'ACKNOWLEDGE' | 'COMPLETE';
    actorId: string;
    requestId: string;
    now: number;
  }) {
    const current = await this.db
      .prepare(
        'SELECT order_id AS orderId, table_id AS tableId, status FROM service_requests WHERE store_id = ? AND id = ?',
      )
      .bind(input.storeId, input.id)
      .first<{ orderId: string; tableId: string; status: string }>();
    if (!current) return null;
    if (
      (input.action === 'ACKNOWLEDGE' && current.status !== 'OPEN') ||
      (input.action === 'COMPLETE' && !['OPEN', 'ACKNOWLEDGED'].includes(current.status))
    ) {
      return { id: input.id, status: current.status, conflict: true };
    }
    const status = input.action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'COMPLETED';
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE service_requests SET status = ?,
             acknowledged_at = CASE WHEN ? = 'ACKNOWLEDGED' THEN ? ELSE acknowledged_at END,
             acknowledged_by = COALESCE(acknowledged_by, ?),
             completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END
           WHERE store_id = ? AND id = ?`,
        )
        .bind(status, status, input.now, input.actorId, status, input.now, input.storeId, input.id),
      this.db
        .prepare(
          `INSERT INTO realtime_event_requests
           SELECT ?, ?, 'pos.order.changed', ?, o.version, ?, NULL, ?, ?,
             json_array('guest.services'),
             json_object('reason', 'SERVICE_REQUEST_UPDATED', 'serviceRequestId', ?,
               'affectedTableIds', json_array(?)), ?
           FROM orders o WHERE o.id = ? AND o.store_id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          input.storeId,
          current.orderId,
          input.actorId,
          input.requestId,
          input.requestId,
          input.id,
          current.tableId,
          input.now,
          current.orderId,
          input.storeId,
        ),
    ]);
    return { id: input.id, status, conflict: false };
  }

  findQrCode(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT id, version, enabled, rotated_at AS rotatedAt
         FROM table_qr_codes WHERE store_id = ? AND table_id = ? LIMIT 1`,
      )
      .bind(storeId, tableId)
      .first<{ id: string; version: number; enabled: 0 | 1; rotatedAt: number }>();
  }

  findTable(storeId: string, tableId: string) {
    return this.db
      .prepare('SELECT id FROM service_tables WHERE store_id = ? AND id = ? LIMIT 1')
      .bind(storeId, tableId)
      .first<{ id: string }>();
  }

  rotateQrCode(input: {
    id: string;
    storeId: string;
    tableId: string;
    tokenHash: string;
    actorId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO table_qr_codes (
          id, store_id, table_id, token_hash, version, enabled, created_by, created_at, rotated_at
        ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
        ON CONFLICT(store_id, table_id) DO UPDATE SET
          token_hash = excluded.token_hash, version = version + 1,
          enabled = 1, rotated_at = excluded.rotated_at`,
      )
      .bind(
        input.id,
        input.storeId,
        input.tableId,
        input.tokenHash,
        input.actorId,
        input.now,
        input.now,
      )
      .run();
  }
}
