export class StoreRepository {
  constructor(private readonly db: D1Database) {}

  getSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          s.id, s.name, s.status, s.timezone, ss.phone, ss.address,
          ss.currency, ss.business_day_cutoff_minutes AS businessDayCutoffMinutes,
          ss.bank_name AS bankName, ss.bank_account_number AS bankAccountNumber,
          ss.bank_account_name AS bankAccountName, ss.bank_qr_media_id AS bankQrMediaId
         FROM stores s JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first();
  }

  async updateSettings(input: {
    storeId: string;
    name: string;
    phone: string | null;
    address: string | null;
    cutoff: number;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
    bankQrMediaId: string | null;
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare('UPDATE stores SET name = ?, updated_at = ? WHERE id = ?')
        .bind(input.name, input.now, input.storeId),
      this.db
        .prepare(
          `UPDATE store_settings
           SET phone = ?, address = ?, business_day_cutoff_minutes = ?,
               bank_name = ?, bank_account_number = ?, bank_account_name = ?,
               bank_qr_media_id = ?, updated_at = ?
           WHERE store_id = ?`,
        )
        .bind(
          input.phone,
          input.address,
          input.cutoff,
          input.bankName,
          input.bankAccountNumber,
          input.bankAccountName,
          input.bankQrMediaId,
          input.now,
          input.storeId,
        ),
    ]);
  }

  async listAuditLogs(storeId: string, limit: number) {
    return this.db
      .prepare(
        `SELECT
          al.id, al.action, al.entity_type AS entityType, al.entity_id AS entityId,
          al.request_id AS requestId, al.before_json AS beforeJson,
          al.after_json AS afterJson, al.created_at AS createdAt,
          u.display_name AS actorName, d.name AS deviceName
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         LEFT JOIN devices d ON d.id = al.device_id
         WHERE al.store_id = ? ORDER BY al.created_at DESC LIMIT ?`,
      )
      .bind(storeId, limit)
      .all();
  }
}
