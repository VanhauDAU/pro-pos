export class PlatformRepository {
  constructor(private readonly db: D1Database) {}

  async hasSuperAdmin() {
    const row = await this.db
      .prepare("SELECT 1 AS found FROM users WHERE platform_role = 'SUPER_ADMIN' LIMIT 1")
      .first<{ found: 1 }>();
    return row?.found === 1;
  }

  async createSuperAdmin(input: { id: string; email: string; displayName: string; now: number }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO users (
            id, platform_role, username, email, display_name, status, created_at, updated_at
          ) VALUES (?, 'SUPER_ADMIN', ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(input.id, input.email, input.email, input.displayName, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO access_identities (
            user_id, provider, email, credential_version, created_at, updated_at
          ) VALUES (?, 'CLOUDFLARE_ACCESS', ?, 1, ?, ?)`,
        )
        .bind(input.id, input.email, input.now, input.now),
    ]);
  }

  async createStoreWithOwner(input: {
    storeId: string;
    storeName: string;
    ownerRoleId: string;
    employeeRoleId: string;
    ownerUserId: string;
    ownerMembershipId: string;
    ownerDisplayName: string;
    ownerEmail: string;
    now: number;
  }) {
    const employeePermissions = [
      'table.view',
      'table.open',
      'order.manage',
      'order.create',
      'checkout.complete',
      'invoice.view',
      'invoice.print',
    ];
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO stores (id, name, status, timezone, created_at, updated_at)
           VALUES (?, ?, 'ACTIVE', 'Asia/Ho_Chi_Minh', ?, ?)`,
        )
        .bind(input.storeId, input.storeName, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO store_settings (store_id, currency, business_day_cutoff_minutes, updated_at)
           VALUES (?, 'VND', 0, ?)`,
        )
        .bind(input.storeId, input.now),
      this.db
        .prepare(
          `INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, 'OWNER', 'Chủ cửa hàng', 1, ?, ?)`,
        )
        .bind(input.ownerRoleId, input.storeId, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, 'EMPLOYEE', 'Nhân viên', 1, ?, ?)`,
        )
        .bind(input.employeeRoleId, input.storeId, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
           SELECT ?, ?, key, ? FROM permissions`,
        )
        .bind(input.storeId, input.ownerRoleId, input.now),
      ...employeePermissions.map((permission) =>
        this.db
          .prepare(
            `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.storeId, input.employeeRoleId, permission, input.now),
      ),
      this.db
        .prepare(
          `INSERT INTO users (
            id, username, email, display_name, status, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`,
        )
        .bind(
          input.ownerUserId,
          input.ownerEmail,
          input.ownerEmail,
          input.ownerDisplayName,
          input.now,
          input.now,
        ),
      this.db
        .prepare(
          `INSERT INTO access_identities (
            user_id, provider, email, credential_version, created_at, updated_at
          ) VALUES (?, 'CLOUDFLARE_ACCESS', ?, 1, ?, ?)`,
        )
        .bind(input.ownerUserId, input.ownerEmail, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO store_memberships (
            id, store_id, user_id, role_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(
          input.ownerMembershipId,
          input.storeId,
          input.ownerUserId,
          input.ownerRoleId,
          input.now,
          input.now,
        ),
    ]);
  }

  async listStores() {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.status, s.timezone,
                s.created_at AS createdAt, s.updated_at AS updatedAt,
                EXISTS (
                  SELECT 1 FROM store_capabilities sc
                  WHERE sc.store_id = s.id AND sc.capability = 'POS_REALTIME' AND sc.enabled = 1
                ) AS posRealtimeEnabled
         FROM stores s ORDER BY s.created_at DESC`,
      )
      .all();
  }

  async setStoreCapability(input: {
    storeId: string;
    capability: 'POS_REALTIME';
    enabled: boolean;
    actorId: string;
    requestId: string;
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO store_capabilities (store_id, capability, enabled, updated_by, updated_at)
           SELECT id, ?, ?, ?, ? FROM stores WHERE id = ?
           ON CONFLICT(store_id, capability) DO UPDATE SET
             enabled = excluded.enabled,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .bind(input.capability, input.enabled ? 1 : 0, input.actorId, input.now, input.storeId),
      this.db
        .prepare(
          `INSERT INTO audit_logs (
            id, store_id, actor_user_id, action, entity_type, entity_id,
            request_id, after_json, created_at
          ) SELECT ?, id, ?, 'STORE_CAPABILITY_UPDATED', 'STORE', id, ?, ?, ?
            FROM stores WHERE id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          input.actorId,
          input.requestId,
          JSON.stringify({ capability: input.capability, enabled: input.enabled }),
          input.now,
          input.storeId,
        ),
    ]);
    return this.db
      .prepare(
        `SELECT enabled FROM store_capabilities
         WHERE store_id = ? AND capability = ? LIMIT 1`,
      )
      .bind(input.storeId, input.capability)
      .first<{ enabled: 0 | 1 }>();
  }

  async setStoreStatus(storeId: string, status: 'ACTIVE' | 'LOCKED', now: number) {
    return this.db
      .prepare('UPDATE stores SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, storeId)
      .run();
  }
}
