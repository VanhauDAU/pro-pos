import type {
  GuestMenuProduct,
  GuestOrderRequestDto,
  ServiceRequestDto,
  StaffNotificationAuditDto,
  TableOpenRequestDto,
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
  locationVerificationEnabled: number;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
  qrOrderEnabled: number;
}

export interface QrTableContextRow {
  qrId: string;
  storeId: string;
  storeName: string;
  tableId: string;
  tableName: string;
  areaName: string;
  tableStatus: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
  tableVersion: number;
  locationVerificationEnabled: number;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
  qrOrderEnabled: number;
}

export interface GuestSessionRow extends QrActiveContextRow {
  guestSessionId: string;
  expiresAt: number;
  locationVerifiedAt: number | null;
  locationDistanceMeters: number | null;
  locationAccuracyMeters: number | null;
  locationExpiresAt: number | null;
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

export interface StaffOperationalAuditRow {
  id: string;
  action: string;
  entityId: string | null;
  requestId: string;
  orderId: string | null;
  orderCode: string | null;
  tableId: string | null;
  tableName: string | null;
  areaName: string | null;
  productName: string | null;
  variantName: string | null;
  actorName: string | null;
  deviceName: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: number;
}

export class QrOrderRepository {
  constructor(private readonly db: D1Database) {}

  findQrTableContext(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT qr.id AS qrId, s.id AS storeId, s.name AS storeName,
                st.id AS tableId, COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, st.status AS tableStatus, st.version AS tableVersion,
                ss.location_verification_enabled AS locationVerificationEnabled,
                ss.latitude AS latitude, ss.longitude AS longitude,
                ss.allowed_radius_meters AS allowedRadiusMeters,
                ss.max_accuracy_meters AS maxAccuracyMeters,
                st.qr_order_enabled AS qrOrderEnabled
         FROM table_qr_codes qr
         JOIN stores s ON s.id = qr.store_id AND s.status = 'ACTIVE'
         JOIN store_settings ss ON ss.store_id = s.id
         JOIN service_tables st ON st.id = qr.table_id AND st.store_id = qr.store_id
         JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id AND a.status = 'ACTIVE'
         WHERE qr.token_hash = ? AND qr.enabled = 1 LIMIT 1`,
      )
      .bind(tokenHash)
      .first<QrTableContextRow>();
  }

  findActiveQrContext(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT qr.id AS qrId, s.id AS storeId, s.name AS storeName,
                st.id AS tableId, COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, ts.id AS timeSessionId, o.id AS orderId,
                o.version AS orderVersion,
                ss.location_verification_enabled AS locationVerificationEnabled,
                ss.latitude AS latitude, ss.longitude AS longitude,
                ss.allowed_radius_meters AS allowedRadiusMeters,
                ss.max_accuracy_meters AS maxAccuracyMeters,
                st.qr_order_enabled AS qrOrderEnabled
         FROM table_qr_codes qr
         JOIN stores s ON s.id = qr.store_id AND s.status = 'ACTIVE'
         JOIN store_settings ss ON ss.store_id = s.id
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

  findOpenTableRequest(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT id, status, created_at AS createdAt
         FROM table_open_requests
         WHERE store_id = ? AND table_id = ? AND status = 'OPEN'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(storeId, tableId)
      .first<{ id: string; status: 'OPEN'; createdAt: number }>();
  }

  expireTableOpenRequests(storeId: string, before: number, now: number) {
    return this.db
      .prepare(
        `UPDATE table_open_requests
         SET status = 'CANCELLED', handled_at = ?, cancel_reason = 'Yêu cầu đã hết hạn.'
         WHERE store_id = ? AND status = 'OPEN' AND created_at <= ?`,
      )
      .bind(now, storeId, before)
      .run();
  }

  async createTableOpenRequest(input: {
    id: string;
    context: QrTableContextRow;
    customerName?: string | null;
    ipHash: string | null;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO table_open_requests (
          id, store_id, table_id, qr_code_id, status, ip_hash, created_at, customer_name
        ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.context.storeId,
        input.context.tableId,
        input.context.qrId,
        input.ipHash,
        input.now,
        input.customerName ?? null,
      )
      .run();
  }

  async listTableOpenRequests(storeId: string): Promise<TableOpenRequestDto[]> {
    const result = await this.db
      .prepare(
        `SELECT tor.id, tor.status, tor.table_id AS tableId,
                COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, st.version AS tableVersion,
                tor.created_at AS createdAt,
                tor.customer_name AS customerName
         FROM table_open_requests tor
         JOIN service_tables st ON st.id = tor.table_id AND st.store_id = tor.store_id
         JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
         WHERE tor.store_id = ? AND tor.status = 'OPEN'
         ORDER BY tor.created_at ASC`,
      )
      .bind(storeId)
      .all<TableOpenRequestDto>();
    return result.results;
  }

  getTableOpenRequest(storeId: string, id: string) {
    return this.db
      .prepare(
        `SELECT tor.id, tor.status, tor.table_id AS tableId,
                st.status AS tableStatus, st.version AS tableVersion,
                tor.customer_name AS customerName
         FROM table_open_requests tor
         JOIN service_tables st ON st.id = tor.table_id AND st.store_id = tor.store_id
         WHERE tor.store_id = ? AND tor.id = ? LIMIT 1`,
      )
      .bind(storeId, id)
      .first<{
        id: string;
        status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
        tableId: string;
        tableStatus: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
        tableVersion: number;
        customerName?: string | null;
      }>();
  }

  completeTableOpenRequest(input: { storeId: string; id: string; actorId: string; now: number }) {
    return this.db
      .prepare(
        `UPDATE table_open_requests
         SET status = 'COMPLETED', handled_at = ?, handled_by = ?
         WHERE store_id = ? AND id = ? AND status = 'OPEN'`,
      )
      .bind(input.now, input.actorId, input.storeId, input.id)
      .run();
  }

  cancelTableOpenRequest(input: {
    storeId: string;
    id: string;
    actorId: string;
    reason: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `UPDATE table_open_requests
         SET status = 'CANCELLED', handled_at = ?, handled_by = ?, cancel_reason = ?
         WHERE store_id = ? AND id = ? AND status = 'OPEN'`,
      )
      .bind(input.now, input.actorId, input.reason, input.storeId, input.id)
      .run();
  }

  findGuestSession(secretHash: string, now: number) {
    return this.db
      .prepare(
        `SELECT gs.id AS guestSessionId, gs.expires_at AS expiresAt,
                gs.location_verified_at AS locationVerifiedAt,
                gs.location_distance_meters AS locationDistanceMeters,
                gs.location_accuracy_meters AS locationAccuracyMeters,
                gs.location_expires_at AS locationExpiresAt,
                qr.id AS qrId, s.id AS storeId, s.name AS storeName,
                st.id AS tableId, COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, ts.id AS timeSessionId, o.id AS orderId,
                o.version AS orderVersion,
                ss.location_verification_enabled AS locationVerificationEnabled,
                ss.latitude AS latitude, ss.longitude AS longitude,
                ss.allowed_radius_meters AS allowedRadiusMeters,
                ss.max_accuracy_meters AS maxAccuracyMeters,
                st.qr_order_enabled AS qrOrderEnabled
         FROM guest_order_sessions gs
         JOIN table_qr_codes qr ON qr.id = gs.qr_code_id AND qr.enabled = 1
         JOIN stores s ON s.id = gs.store_id AND s.status = 'ACTIVE'
         JOIN store_settings ss ON ss.store_id = s.id
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

  updateGuestLocationVerification(input: {
    guestSessionId: string;
    verifiedAt: number;
    distanceMeters: number;
    accuracyMeters: number;
    expiresAt: number;
  }) {
    return this.db
      .prepare(
        `UPDATE guest_order_sessions
         SET location_verified_at = ?, location_distance_meters = ?,
             location_accuracy_meters = ?, location_expires_at = ?
         WHERE id = ?`,
      )
      .bind(
        input.verifiedAt,
        input.distanceMeters,
        input.accuracyMeters,
        input.expiresAt,
        input.guestSessionId,
      )
      .run();
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

  async listMenu(storeId: string, includeHidden = false): Promise<GuestMenuProduct[]> {
    const result = await this.db
      .prepare(
        `SELECT p.id AS productId, p.name AS productName, p.product_type AS productType,
                p.category_id AS categoryId,
                c.name AS categoryName, p.avatar_type AS avatarType,
                p.avatar_color AS avatarColor, p.media_id AS mediaId,
                u.name AS unitName, pv.id AS variantId, pv.name AS variantName,
                pv.sale_price AS salePriceVnd, pv.qr_order_enabled AS qrOrderEnabled
         FROM products p
         JOIN product_variants pv ON pv.product_id = p.id AND pv.store_id = p.store_id
           AND pv.status = 'ACTIVE' AND pv.prompt_price = 0 AND pv.sale_price IS NOT NULL
         LEFT JOIN categories c ON c.id = p.category_id AND c.store_id = p.store_id
         LEFT JOIN units u ON u.id = p.unit_id AND u.store_id = p.store_id
         WHERE p.store_id = ? AND p.status = 'ACTIVE' AND p.is_system = 0
           AND p.product_type IN ('QUANTITY', 'WEIGHT')
           AND (? = 1 OR pv.qr_order_enabled = 1)
         ORDER BY c.sort_order, p.name COLLATE NOCASE, pv.name COLLATE NOCASE`,
      )
      .bind(storeId, includeHidden ? 1 : 0)
      .all<{
        productId: string;
        productName: string;
        productType: 'QUANTITY' | 'WEIGHT';
        categoryId: string | null;
        categoryName: string | null;
        avatarType: 'COLOR' | 'IMAGE';
        avatarColor: string | null;
        mediaId: string | null;
        qrOrderEnabled: 0 | 1;
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
        productType: row.productType,
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
        qrOrderEnabled: row.qrOrderEnabled === 1,
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
           AND p.product_type IN ('QUANTITY', 'WEIGHT') AND pv.qr_order_enabled = 1
           AND (? IS NULL OR pv.id = ?)
         ORDER BY pv.created_at LIMIT 1`,
      )
      .bind(storeId, productId, variantId, variantId)
      .first<{
        productId: string;
        productName: string;
        productType: 'QUANTITY' | 'WEIGHT';
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

  findLatestGuestRequest(guestSessionId: string) {
    return this.db
      .prepare(
        `SELECT id, created_at AS createdAt FROM guest_order_requests
         WHERE guest_session_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(guestSessionId)
      .first<{ id: string; createdAt: number }>();
  }

  async createGuestOrder(input: {
    commandId: string;
    requestId: string;
    clientRequestId: string;
    session: GuestSessionRow;
    note: string | null;
    ipHash: string | null;
    now: number;
    notificationSummary: string;
    notificationItemCount: number;
    notificationTotalVnd: number;
    notificationExpiresAt: number;
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
    customerName?: string | null;
  }) {
    const stmts = [
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
      this.db
        .prepare(
          `INSERT INTO staff_notification_events (
            id, store_id, source_type, source_id, event_type, status,
            order_id, table_id, table_name_snapshot, area_name_snapshot,
            summary, note, item_count, total_vnd, created_at, expires_at
          ) VALUES (?, ?, 'GUEST_ORDER', ?, 'QR_ORDER', 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(store_id, source_type, source_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          input.session.storeId,
          input.requestId,
          input.session.orderId,
          input.session.tableId,
          input.session.tableName,
          input.session.areaName,
          input.notificationSummary,
          input.note,
          input.notificationItemCount,
          input.notificationTotalVnd,
          input.now,
          input.notificationExpiresAt,
        ),
    ];
    if (input.customerName) {
      stmts.push(
        this.db
          .prepare(`UPDATE guest_order_requests SET customer_name = ? WHERE id = ?`)
          .bind(input.customerName, input.requestId),
        this.db
          .prepare(
            `UPDATE orders SET customer_name = ?
             WHERE id = ? AND (customer_name IS NULL OR customer_name = '' OR customer_name = 'Khách lẻ')`,
          )
          .bind(input.customerName, input.session.orderId),
      );
    }
    await this.db.batch(stmts);
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
                gor.rejected_reason AS rejectedReason,
                COALESCE(gor.customer_name, o.customer_name) AS customerName
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

  async acceptRequest(input: {
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
    return this.db.batch([
      this.db
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
        ),
      this.db
        .prepare(
          `UPDATE staff_notification_events
           SET status = 'ACCEPTED', actor_user_id = ?, actor_session_id = ?,
               device_id = ?, handled_at = ?
           WHERE store_id = ? AND source_type = 'GUEST_ORDER' AND source_id = ?`,
        )
        .bind(
          input.actorId,
          input.actorSessionId,
          input.deviceId,
          input.now,
          input.storeId,
          input.guestRequestId,
        ),
    ]);
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

  async rejectRequest(input: {
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
    return this.db.batch([
      this.db
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
        ),
      this.db
        .prepare(
          `UPDATE staff_notification_events
           SET status = 'REJECTED', note = ?, actor_user_id = ?, actor_session_id = ?,
               device_id = ?, handled_at = ?
           WHERE store_id = ? AND source_type = 'GUEST_ORDER' AND source_id = ?`,
        )
        .bind(
          input.reason,
          input.actorId,
          input.actorSessionId,
          input.deviceId,
          input.now,
          input.storeId,
          input.guestRequestId,
        ),
    ]);
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
        `SELECT id, created_at AS createdAt FROM service_requests
         WHERE time_session_id = ? AND type = ?
           AND (status IN ('OPEN', 'ACKNOWLEDGED') OR created_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(timeSessionId, type, since)
      .first<{ id: string; createdAt?: number }>();
  }

  async createServiceRequest(input: {
    id: string;
    session: GuestSessionRow;
    type: 'CALL_STAFF' | 'CHECKOUT_REQUEST';
    customerName?: string | null;
    reasonId?: string | null;
    reasonSnapshot?: string | null;
    now: number;
    notificationExpiresAt: number;
  }) {
    const stmts = [
      this.db
        .prepare(
          `INSERT INTO service_requests (
            id, store_id, table_id, time_session_id, order_id, guest_session_id,
            type, status, created_at, customer_name, reason_id, reason_snapshot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
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
          input.customerName ?? null,
          input.reasonId ?? null,
          input.reasonSnapshot ?? null,
        ),
      this.db
        .prepare(
          `INSERT INTO realtime_event_requests VALUES (
            ?, ?, 'pos.order.changed', ?, ?, NULL, NULL, ?, ?,
            json_array('guest.services'),
            json_object('reason', 'SERVICE_REQUEST_CREATED', 'serviceRequestId', ?,
              'serviceRequestType', ?, 'affectedTableIds', json_array(?)), ?
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
          input.type,
          input.session.tableId,
          input.now,
        ),
      this.db
        .prepare(
          `INSERT INTO staff_notification_events (
            id, store_id, source_type, source_id, event_type, status,
            order_id, table_id, table_name_snapshot, area_name_snapshot,
            summary, note, item_count, total_vnd, created_at, expires_at
          ) VALUES (?, ?, 'SERVICE_REQUEST', ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
          ON CONFLICT(store_id, source_type, source_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          input.session.storeId,
          input.id,
          input.type,
          input.session.orderId,
          input.session.tableId,
          input.session.tableName,
          input.session.areaName,
          input.type === 'CALL_STAFF'
            ? input.customerName
              ? `Khách (${input.customerName}) gọi nhân viên hỗ trợ`
              : 'Khách gọi nhân viên hỗ trợ'
            : input.customerName
              ? `Khách (${input.customerName}) yêu cầu thanh toán`
              : 'Khách yêu cầu thanh toán',
          input.reasonSnapshot ?? null,
          input.now,
          input.notificationExpiresAt,
        ),
    ];
    if (input.customerName) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE orders SET customer_name = ?
             WHERE id = ? AND (customer_name IS NULL OR customer_name = '' OR customer_name = 'Khách lẻ')`,
          )
          .bind(input.customerName, input.session.orderId),
      );
    }
    await this.db.batch(stmts);
  }

  async listServiceRequests(storeId: string): Promise<ServiceRequestDto[]> {
    const result = await this.db
      .prepare(
        `SELECT sr.id, sr.type, sr.status,
                sr.table_id AS tableId, sr.order_id AS orderId,
                COALESCE(st.display_name, st.name) AS tableName,
                a.name AS areaName, sr.created_at AS createdAt,
                sr.acknowledged_at AS acknowledgedAt,
                COALESCE(sr.customer_name, o.customer_name) AS customerName,
                sr.reason_snapshot AS reason
         FROM service_requests sr
         JOIN service_tables st ON st.id = sr.table_id
         JOIN areas a ON a.id = st.area_id
         LEFT JOIN orders o ON o.id = sr.order_id
         WHERE sr.store_id = ? AND sr.status IN ('OPEN', 'ACKNOWLEDGED')
         ORDER BY sr.created_at DESC`,
      )
      .bind(storeId)
      .all<ServiceRequestDto>();
    return result.results;
  }

  async listNotificationAudit(
    storeId: string,
    limit: number,
  ): Promise<StaffNotificationAuditDto[]> {
    const result = await this.db
      .prepare(
        `SELECT sne.id, sne.source_id AS sourceId, sne.event_type AS eventType,
                sne.status, sne.order_id AS orderId, sne.table_id AS tableId,
                sne.table_name_snapshot AS tableName, sne.area_name_snapshot AS areaName,
                sne.summary, sne.note, sne.item_count AS itemCount,
                sne.total_vnd AS totalVnd, u.display_name AS actorName,
                d.name AS deviceName, sne.handled_at AS handledAt,
                sne.created_at AS createdAt
         FROM staff_notification_events sne
         LEFT JOIN users u ON u.id = sne.actor_user_id
         LEFT JOIN devices d ON d.id = sne.device_id
         WHERE sne.store_id = ?
         ORDER BY sne.created_at DESC
         LIMIT ?`,
      )
      .bind(storeId, limit)
      .all<StaffNotificationAuditDto>();
    return result.results;
  }

  async listOperationalAudit(storeId: string, since: number, limit: number) {
    const result = await this.db
      .prepare(
        `WITH selected AS (
           SELECT al.*,
             COALESCE(
               json_extract(al.after_json, '$.orderId'),
               json_extract(al.after_json, '$.order_id'),
               json_extract(al.before_json, '$.orderId'),
               CASE WHEN al.entity_type = 'ORDER' THEN al.entity_id END
             ) AS resolved_order_id,
             json_extract(al.after_json, '$.productId') AS resolved_product_id,
             json_extract(al.after_json, '$.variantId') AS resolved_variant_id
           FROM audit_logs al
           WHERE al.store_id = ? AND al.created_at >= ? AND al.action IN (
             'TABLE_OPENED', 'TAKEAWAY_ORDER_CREATED',
             'ORDER_ITEM_ADDED', 'ORDER_ITEM_ADDED_WITH_DISCOUNT',
             'ORDER_ITEM_UPDATED', 'ORDER_ITEM_REMOVED', 'ORDER_NOTE_UPDATED',
             'TABLE_TRANSFERRED', 'TIME_PAUSED', 'TIME_RESUMED',
             'TIME_RANGE_UPDATED', 'TIME_SESSION_REMOVED', 'TIME_SESSION_RESTORED',
             'ORDER_CHECKOUT_PENDING', 'ORDER_RESUMED_FROM_CHECKOUT',
             'CHECKOUT_COMPLETED', 'ORDER_CANCELLED'
           )
         )
         SELECT s.id, s.action, s.entity_id AS entityId, s.request_id AS requestId,
                s.resolved_order_id AS orderId,
                COALESCE(o.display_code, tor.display_code) AS orderCode,
                st.id AS tableId,
                COALESCE(st.display_name, st.name,
                  CASE WHEN tor.id IS NOT NULL THEN 'Mang về' END) AS tableName,
                a.name AS areaName,
                COALESCE(p.name, oi.product_name_snapshot, toi.product_name_snapshot) AS productName,
                COALESCE(pv.name, oi.variant_name_snapshot, toi.variant_name_snapshot) AS variantName,
                u.display_name AS actorName, d.name AS deviceName,
                s.before_json AS beforeJson, s.after_json AS afterJson,
                s.created_at AS createdAt
         FROM selected s
         LEFT JOIN orders o ON o.id = s.resolved_order_id AND o.store_id = s.store_id
         LEFT JOIN takeaway_orders tor
           ON tor.id = s.resolved_order_id AND tor.store_id = s.store_id
         LEFT JOIN service_tables st ON st.id = o.table_id AND st.store_id = o.store_id
         LEFT JOIN areas a ON a.id = st.area_id AND a.store_id = st.store_id
         LEFT JOIN products p
           ON p.id = s.resolved_product_id AND p.store_id = s.store_id
         LEFT JOIN product_variants pv
           ON pv.id = s.resolved_variant_id AND pv.store_id = s.store_id
         LEFT JOIN order_items oi
           ON oi.id = s.entity_id AND oi.store_id = s.store_id
         LEFT JOIN takeaway_order_items toi
           ON toi.id = s.entity_id AND toi.store_id = s.store_id
         LEFT JOIN users u ON u.id = s.actor_user_id
         LEFT JOIN devices d ON d.id = s.device_id
         ORDER BY s.created_at DESC
         LIMIT ?`,
      )
      .bind(storeId, since, limit)
      .all<StaffOperationalAuditRow>();
    return result.results;
  }

  cleanupExpiredNotifications(now: number) {
    return this.db
      .prepare('DELETE FROM staff_notification_events WHERE expires_at <= ?')
      .bind(now)
      .run();
  }

  cleanupExpiredOperationalAudit(before: number) {
    return this.db
      .prepare(
        `DELETE FROM audit_logs
         WHERE created_at < ? AND action IN (
           'TABLE_OPENED', 'TAKEAWAY_ORDER_CREATED',
           'ORDER_ITEM_ADDED', 'ORDER_ITEM_ADDED_WITH_DISCOUNT',
           'ORDER_ITEM_UPDATED', 'ORDER_ITEM_REMOVED', 'ORDER_NOTE_UPDATED',
           'TABLE_TRANSFERRED', 'TIME_PAUSED', 'TIME_RESUMED',
           'TIME_RANGE_UPDATED', 'TIME_SESSION_REMOVED', 'TIME_SESSION_RESTORED',
           'ORDER_CHECKOUT_PENDING', 'ORDER_RESUMED_FROM_CHECKOUT',
           'CHECKOUT_COMPLETED', 'ORDER_CANCELLED'
         )`,
      )
      .bind(before)
      .run();
  }

  async updateServiceRequest(input: {
    storeId: string;
    id: string;
    action: 'ACKNOWLEDGE' | 'COMPLETE';
    actorId: string;
    actorSessionId: string | null;
    deviceId: string | null;
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
      this.db
        .prepare(
          `UPDATE staff_notification_events
           SET status = ?, actor_user_id = ?, actor_session_id = ?, device_id = ?,
               handled_at = ?
           WHERE store_id = ? AND source_type = 'SERVICE_REQUEST' AND source_id = ?`,
        )
        .bind(
          status,
          input.actorId,
          input.actorSessionId,
          input.deviceId,
          input.now,
          input.storeId,
          input.id,
        ),
    ]);
    return { id: input.id, status, conflict: false };
  }

  findQrCode(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `SELECT id, version, enabled, rotated_at AS rotatedAt, public_token AS publicToken
         FROM table_qr_codes WHERE store_id = ? AND table_id = ? LIMIT 1`,
      )
      .bind(storeId, tableId)
      .first<{
        id: string;
        version: number;
        enabled: 0 | 1;
        rotatedAt: number;
        publicToken: string | null;
      }>();
  }

  findTable(storeId: string, tableId: string) {
    return this.db
      .prepare('SELECT id FROM service_tables WHERE store_id = ? AND id = ? LIMIT 1')
      .bind(storeId, tableId)
      .first<{ id: string }>();
  }

  upsertQrCode(input: {
    id: string;
    storeId: string;
    tableId: string;
    tokenHash: string;
    publicToken: string;
    actorId: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO table_qr_codes (
          id, store_id, table_id, token_hash, public_token, version, enabled,
          created_by, created_at, rotated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
        ON CONFLICT(store_id, table_id) DO UPDATE SET
          token_hash = excluded.token_hash, public_token = excluded.public_token,
          version = version + 1, enabled = 1, rotated_at = excluded.rotated_at`,
      )
      .bind(
        input.id,
        input.storeId,
        input.tableId,
        input.tokenHash,
        input.publicToken,
        input.actorId,
        input.now,
        input.now,
      )
      .run();
  }

  revokeGuestSessionsByTable(storeId: string, tableId: string) {
    return this.db
      .prepare(
        `UPDATE guest_order_sessions SET status = 'REVOKED'
         WHERE store_id = ? AND table_id = ? AND status = 'ACTIVE'`,
      )
      .bind(storeId, tableId)
      .run();
  }
}
