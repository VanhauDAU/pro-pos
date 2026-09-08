export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushSubscriptionRepository {
  constructor(private readonly db: D1Database) {}

  upsert(input: {
    storeId: string;
    userId: string;
    deviceId: string | null;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO push_subscriptions (
          id, store_id, user_id, device_id, endpoint, p256dh, auth,
          user_agent, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          store_id = excluded.store_id, user_id = excluded.user_id,
          device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth,
          user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at`,
      )
      .bind(
        crypto.randomUUID(),
        input.storeId,
        input.userId,
        input.deviceId,
        input.endpoint,
        input.p256dh,
        input.auth,
        input.userAgent,
        input.now,
        input.now,
      )
      .run();
  }

  async listStore(storeId: string) {
    const result = await this.db
      .prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE store_id = ?`)
      .bind(storeId)
      .all<PushSubscriptionRow>();
    return result.results;
  }

  async listActiveStoreDeviceSubscriptions(
    storeId: string,
    now: number,
    excludeDeviceId?: string | null,
  ) {
    let query = `
      SELECT DISTINCT ps.id, ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscriptions ps
      INNER JOIN auth_sessions s
        ON s.store_id = ps.store_id
       AND s.user_id = ps.user_id
      WHERE ps.store_id = ?
        AND s.status = 'ACTIVE'
        AND s.expires_at > ?
        AND s.idle_expires_at > ?
        AND (ps.device_id IS NULL OR s.device_id IS NULL OR ps.device_id = s.device_id)
    `;
    const params: unknown[] = [storeId, now, now];
    if (excludeDeviceId) {
      query += ` AND (ps.device_id IS NULL OR ps.device_id != ?)`;
      params.push(excludeDeviceId);
    }
    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all<PushSubscriptionRow>();
    return result.results;
  }

  async listEligibleSubscriptions(
    storeId: string,
    kind: string,
    now: number,
    excludeDeviceId?: string | null,
    targetUserId?: string | null,
  ) {
    let query = `
      SELECT DISTINCT ps.id, ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscriptions ps
      LEFT JOIN staff_notification_settings sns
        ON sns.store_id = ps.store_id AND sns.user_id = ps.user_id
      LEFT JOIN auth_sessions s
        ON s.store_id = ps.store_id
       AND s.user_id = ps.user_id
       AND s.status = 'ACTIVE'
       AND s.expires_at > ?
       AND s.idle_expires_at > ?
       AND (ps.device_id IS NULL OR s.device_id IS NULL OR ps.device_id = s.device_id)
      WHERE ps.store_id = ?
        AND COALESCE(sns.enabled, 1) = 1
        AND (
          (? = 'ORDER_PAID' AND COALESCE(sns.notify_order_paid, 1) = 1) OR
          (? = 'QR_ORDER' AND COALESCE(sns.notify_qr_order, 1) = 1) OR
          (? = 'CALL_STAFF' AND COALESCE(sns.notify_call_staff, 1) = 1) OR
          (? = 'CHECKOUT_REQUEST' AND COALESCE(sns.notify_checkout_request, 1) = 1) OR
          (? = 'TABLE_OPEN_REQUEST' AND COALESCE(sns.notify_table_open_request, 1) = 1) OR
          (? IN ('PRINT_COMPLETED', 'PRINT_FAILED', 'PRINT_UNCERTAIN') AND COALESCE(sns.notify_print_status, 1) = 1)
        )
        AND (
          COALESCE(sns.only_active_sessions, 1) = 0
          OR s.id IS NOT NULL
        )
    `;
    const params: unknown[] = [now, now, storeId, kind, kind, kind, kind, kind, kind];
    if (excludeDeviceId) {
      query += ` AND (ps.device_id IS NULL OR ps.device_id != ?)`;
      params.push(excludeDeviceId);
    }
    if (targetUserId) {
      query += ` AND ps.user_id = ?`;
      params.push(targetUserId);
    }
    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all<PushSubscriptionRow>();
    return result.results;
  }

  removeByEndpoint(endpoint: string) {
    return this.db
      .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
      .bind(endpoint)
      .run();
  }

  removeByDevice(storeId: string, deviceId: string) {
    return this.db
      .prepare('DELETE FROM push_subscriptions WHERE store_id = ? AND device_id = ?')
      .bind(storeId, deviceId)
      .run();
  }

  removeByUser(storeId: string, userId: string) {
    return this.db
      .prepare('DELETE FROM push_subscriptions WHERE store_id = ? AND user_id = ?')
      .bind(storeId, userId)
      .run();
  }
}
