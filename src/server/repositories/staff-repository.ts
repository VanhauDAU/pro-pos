export class StaffRepository {
  constructor(private readonly db: D1Database) {}

  async createEmployee(input: {
    storeId: string;
    userId: string;
    membershipId: string;
    roleId: string;
    roleCode: string;
    displayName: string;
    username: string;
    permissionKeys: string[];
    salt: string;
    digest: string;
    now: number;
  }) {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          input.roleId,
          input.storeId,
          input.roleCode,
          `Quyền ${input.displayName}`,
          input.now,
          input.now,
        ),
      ...input.permissionKeys.map((permission) =>
        this.db
          .prepare(
            `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
             SELECT ?, ?, key, ? FROM permissions WHERE key = ?`,
          )
          .bind(input.storeId, input.roleId, input.now, permission),
      ),
      this.db
        .prepare(
          `INSERT INTO users (id, username, display_name, status, created_at, updated_at)
           VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(input.userId, input.username, input.displayName, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO store_memberships (
            id, store_id, user_id, role_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(input.membershipId, input.storeId, input.userId, input.roleId, input.now, input.now),
      this.db
        .prepare(
          `INSERT INTO pin_verifiers (
            user_id, store_id, algorithm, salt, digest,
            pepper_version, credential_version, updated_at
          ) VALUES (?, ?, 'HMAC-SHA256-PEPPERED', ?, ?, 1, 1, ?)`,
        )
        .bind(input.userId, input.storeId, input.salt, input.digest, input.now),
    ];
    await this.db.batch(statements);
  }

  async listEmployees(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          u.id, u.username, u.display_name AS displayName, u.status,
          r.id AS roleId, r.name AS roleName,
          group_concat(rp.permission_key) AS permissionKeys
        FROM store_memberships sm
        JOIN users u ON u.id = sm.user_id
        JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.store_id = r.store_id
        WHERE sm.store_id = ? AND r.code <> 'OWNER'
        GROUP BY u.id, r.id
        ORDER BY u.display_name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all();
  }

  findEmployeeTarget(storeId: string, userId: string) {
    return this.db
      .prepare(
        `SELECT u.id, u.status, sm.status AS membershipStatus, r.code AS roleCode
         FROM store_memberships sm
         JOIN users u ON u.id = sm.user_id
         JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
         WHERE sm.store_id = ? AND sm.user_id = ? AND r.code <> 'OWNER'
         LIMIT 1`,
      )
      .bind(storeId, userId)
      .first<{
        id: string;
        status: 'ACTIVE' | 'DISABLED';
        membershipStatus: 'ACTIVE' | 'DISABLED';
        roleCode: string;
      }>();
  }

  async setEmployeeStatus(
    storeId: string,
    userId: string,
    status: 'ACTIVE' | 'DISABLED',
    now: number,
  ) {
    return this.db.batch([
      this.db
        .prepare(
          `UPDATE users SET status = ?, updated_at = ?
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM store_memberships sm
             JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
             WHERE sm.store_id = ? AND sm.user_id = users.id AND r.code <> 'OWNER'
           )`,
        )
        .bind(status, now, userId, storeId),
      this.db
        .prepare(
          `UPDATE store_memberships SET status = ?, updated_at = ?
           WHERE store_id = ? AND user_id = ?
             AND EXISTS (
               SELECT 1 FROM roles r
               WHERE r.id = store_memberships.role_id
                 AND r.store_id = store_memberships.store_id AND r.code <> 'OWNER'
             )`,
        )
        .bind(status, now, storeId, userId),
      this.db
        .prepare(
          `UPDATE auth_sessions SET status = 'REVOKED', revoked_at = ?
           WHERE store_id = ? AND user_id = ? AND status = 'ACTIVE'`,
        )
        .bind(now, storeId, userId),
    ]);
  }

  async resetPin(input: {
    storeId: string;
    userId: string;
    salt: string;
    digest: string;
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare(
          `UPDATE pin_verifiers
           SET salt = ?, digest = ?,
               credential_version = credential_version + 1, updated_at = ?
           WHERE store_id = ? AND user_id = ? AND session_kind = 'EMPLOYEE'`,
        )
        .bind(input.salt, input.digest, input.now, input.storeId, input.userId),
      this.db
        .prepare(
          `UPDATE auth_sessions SET status = 'REVOKED', revoked_at = ?
           WHERE store_id = ? AND user_id = ? AND session_kind = 'EMPLOYEE'
             AND status = 'ACTIVE'`,
        )
        .bind(input.now, input.storeId, input.userId),
      this.db
        .prepare(
          `DELETE FROM login_attempts WHERE scope = 'EMPLOYEE_PIN'
             AND subject_key LIKE 'pin:%:' || (
               SELECT username FROM users WHERE id = ?
             )`,
        )
        .bind(input.userId),
    ]);
  }
}
