export class AuthorizationRepository {
  constructor(private readonly db: D1Database) {}

  async getStoreStatus(storeId: string) {
    return this.db
      .prepare('SELECT status FROM stores WHERE id = ?')
      .bind(storeId)
      .first<{ status: 'ACTIVE' | 'LOCKED' }>();
  }

  async hasPermission(storeId: string, userId: string, permissionKey: string) {
    const row = await this.db
      .prepare(
        `SELECT 1 AS allowed
         FROM store_memberships sm
         JOIN role_permissions rp
           ON rp.store_id = sm.store_id AND rp.role_id = sm.role_id
         WHERE sm.store_id = ? AND sm.user_id = ? AND sm.status = 'ACTIVE'
           AND rp.permission_key = ?
         LIMIT 1`,
      )
      .bind(storeId, userId, permissionKey)
      .first<{ allowed: 1 }>();
    return row?.allowed === 1;
  }

  async listUserPermissions(storeId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .prepare(
        `SELECT rp.permission_key AS permissionKey
         FROM store_memberships sm
         JOIN role_permissions rp
           ON rp.store_id = sm.store_id AND rp.role_id = sm.role_id
         WHERE sm.store_id = ? AND sm.user_id = ? AND sm.status = 'ACTIVE'
         ORDER BY rp.permission_key ASC`,
      )
      .bind(storeId, userId)
      .all<{ permissionKey: string }>();
    return rows.results.map((r) => r.permissionKey);
  }
}
