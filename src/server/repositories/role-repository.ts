export interface RoleSummaryRow {
  id: string;
  code: string;
  name: string;
  isSystem: 0 | 1;
  memberCount: number;
  permissionCount: number;
}

export interface RoleDetailRow extends RoleSummaryRow {
  permissionKeys: string | null;
}

export class RoleRepository {
  constructor(private readonly db: D1Database) {}

  listRoles(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          r.id, r.code, r.name, r.is_system AS isSystem,
          COUNT(DISTINCT sm.user_id) AS memberCount,
          COUNT(DISTINCT rp.permission_key) AS permissionCount
         FROM roles r
         LEFT JOIN store_memberships sm
           ON sm.role_id = r.id AND sm.store_id = r.store_id AND sm.status = 'ACTIVE'
         LEFT JOIN role_permissions rp
           ON rp.role_id = r.id AND rp.store_id = r.store_id
         WHERE r.store_id = ? AND r.code <> 'OWNER'
         GROUP BY r.id
         ORDER BY r.is_system DESC, r.name COLLATE NOCASE`,
      )
      .bind(storeId)
      .all<RoleSummaryRow>();
  }

  getRole(storeId: string, roleId: string) {
    return this.db
      .prepare(
        `SELECT
          r.id, r.code, r.name, r.is_system AS isSystem,
          COUNT(DISTINCT sm.user_id) AS memberCount,
          COUNT(DISTINCT rp.permission_key) AS permissionCount,
          group_concat(rp.permission_key) AS permissionKeys
         FROM roles r
         LEFT JOIN store_memberships sm
           ON sm.role_id = r.id AND sm.store_id = r.store_id AND sm.status = 'ACTIVE'
         LEFT JOIN role_permissions rp
           ON rp.role_id = r.id AND rp.store_id = r.store_id
         WHERE r.store_id = ? AND r.id = ? AND r.code <> 'OWNER'
         GROUP BY r.id
         LIMIT 1`,
      )
      .bind(storeId, roleId)
      .first<RoleDetailRow>();
  }

  getDefaultEmployeeRole(storeId: string) {
    return this.db
      .prepare(
        `SELECT id, code, name, is_system AS isSystem
         FROM roles WHERE store_id = ? AND code = 'EMPLOYEE' LIMIT 1`,
      )
      .bind(storeId)
      .first<{ id: string; code: string; name: string; isSystem: 0 | 1 }>();
  }

  countPermissions(permissionKeys: string[]) {
    if (permissionKeys.length === 0) return Promise.resolve({ results: [], success: true });
    const placeholders = permissionKeys.map(() => '?').join(', ');
    return this.db
      .prepare(`SELECT key FROM permissions WHERE key IN (${placeholders})`)
      .bind(...permissionKeys)
      .all<{ key: string }>();
  }

  createRole(input: {
    id: string;
    code: string;
    storeId: string;
    name: string;
    permissionKeys: string[];
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare(
          `INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(input.id, input.storeId, input.code, input.name, input.now, input.now),
      ...input.permissionKeys.map((permissionKey) =>
        this.db
          .prepare(
            `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.storeId, input.id, permissionKey, input.now),
      ),
    ]);
  }

  updateRole(input: {
    id: string;
    storeId: string;
    name: string;
    permissionKeys: string[];
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare('UPDATE roles SET name = ?, updated_at = ? WHERE id = ? AND store_id = ?')
        .bind(input.name, input.now, input.id, input.storeId),
      this.db
        .prepare('DELETE FROM role_permissions WHERE role_id = ? AND store_id = ?')
        .bind(input.id, input.storeId),
      ...input.permissionKeys.map((permissionKey) =>
        this.db
          .prepare(
            `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.storeId, input.id, permissionKey, input.now),
      ),
    ]);
  }

  deleteRole(storeId: string, roleId: string) {
    return this.db.batch([
      this.db
        .prepare('DELETE FROM role_permissions WHERE store_id = ? AND role_id = ?')
        .bind(storeId, roleId),
      this.db
        .prepare('DELETE FROM roles WHERE id = ? AND store_id = ? AND is_system = 0')
        .bind(roleId, storeId),
    ]);
  }

  findRoleMembershipCount(storeId: string, roleId: string) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM store_memberships
         WHERE store_id = ? AND role_id = ? AND status = 'ACTIVE'`,
      )
      .bind(storeId, roleId)
      .first<{ count: number }>();
  }
}
