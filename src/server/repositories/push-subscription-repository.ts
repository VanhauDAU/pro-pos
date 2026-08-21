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

  removeByEndpoint(endpoint: string) {
    return this.db
      .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
      .bind(endpoint)
      .run();
  }
}
