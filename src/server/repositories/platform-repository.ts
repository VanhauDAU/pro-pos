export interface SuperAdminCredentialRow {
  user_id: string;
  display_name: string;
  user_status: 'ACTIVE' | 'DISABLED';
  work_factor: number;
  salt: string;
  digest: string;
  credential_version: number;
}

export class PlatformRepository {
  constructor(private readonly db: D1Database) {}

  async hasSuperAdmin() {
    const row = await this.db
      .prepare("SELECT 1 AS found FROM users WHERE platform_role = 'SUPER_ADMIN' LIMIT 1")
      .first<{ found: 1 }>();
    return row?.found === 1;
  }

  async createSuperAdmin(input: {
    id: string;
    username: string;
    displayName: string;
    workFactor: number;
    salt: string;
    digest: string;
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO users (
            id, platform_role, username, display_name, status, created_at, updated_at
          ) VALUES (?, 'SUPER_ADMIN', ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(input.id, input.username, input.displayName, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO password_credentials (
            user_id, algorithm, work_factor, salt, digest, pepper_version,
            credential_version, updated_at
          ) VALUES (?, 'PBKDF2-HMAC-SHA256', ?, ?, ?, 1, 1, ?)`,
        )
        .bind(input.id, input.workFactor, input.salt, input.digest, input.now),
    ]);
  }

  findSuperAdminByUsername(username: string) {
    return this.db
      .prepare(
        `SELECT
          u.id AS user_id, u.display_name, u.status AS user_status,
          pc.work_factor, pc.salt, pc.digest, pc.credential_version
        FROM users u
        JOIN password_credentials pc ON pc.user_id = u.id
        WHERE u.username = ? COLLATE NOCASE AND u.platform_role = 'SUPER_ADMIN'
        LIMIT 1`,
      )
      .bind(username)
      .first<SuperAdminCredentialRow>();
  }

  async createStoreWithOwner(input: {
    storeId: string;
    storeName: string;
    ownerRoleId: string;
    employeeRoleId: string;
    ownerUserId: string;
    ownerMembershipId: string;
    ownerDisplayName: string;
    ownerUsername: string;
    workFactor: number;
    salt: string;
    digest: string;
    now: number;
  }) {
    const employeePermissions = [
      'table.view',
      'table.open',
      'order.manage',
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
            id, username, display_name, status, must_change_password, created_at, updated_at
          ) VALUES (?, ?, ?, 'ACTIVE', 1, ?, ?)`,
        )
        .bind(input.ownerUserId, input.ownerUsername, input.ownerDisplayName, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO password_credentials (
            user_id, algorithm, work_factor, salt, digest, pepper_version,
            credential_version, updated_at
          ) VALUES (?, 'PBKDF2-HMAC-SHA256', ?, ?, ?, 1, 1, ?)`,
        )
        .bind(input.ownerUserId, input.workFactor, input.salt, input.digest, input.now),
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
        `SELECT id, name, status, timezone, created_at AS createdAt, updated_at AS updatedAt
         FROM stores ORDER BY created_at DESC`,
      )
      .all();
  }

  async setStoreStatus(storeId: string, status: 'ACTIVE' | 'LOCKED', now: number) {
    return this.db
      .prepare('UPDATE stores SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, storeId)
      .run();
  }
}
