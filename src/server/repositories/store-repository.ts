export class StoreRepository {
  constructor(private readonly db: D1Database) {}

  getSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          s.id, s.name, s.status, s.timezone, ss.phone, ss.address,
          ss.currency, ss.business_day_cutoff_minutes AS businessDayCutoffMinutes,
          ss.bank_name AS bankName, ss.bank_account_number AS bankAccountNumber,
          ss.bank_account_name AS bankAccountName, ss.bank_qr_media_id AS bankQrMediaId,
          ss.province_code AS provinceCode, ss.province_name AS provinceName,
          ss.ward_code AS wardCode, ss.ward_name AS wardName
         FROM stores s JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first();
  }

  findActiveBankQrMedia(storeId: string, mediaId: string) {
    return this.db
      .prepare(
        `SELECT id, mime_type AS mimeType FROM media_objects
         WHERE id = ? AND store_id = ? AND status = 'ACTIVE'
           AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
         LIMIT 1`,
      )
      .bind(mediaId, storeId)
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
    provinceCode: number | null;
    provinceName: string | null;
    wardCode: number | null;
    wardName: string | null;
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
               bank_qr_media_id = ?, province_code = ?, province_name = ?,
               ward_code = ?, ward_name = ?, updated_at = ?
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
          input.provinceCode,
          input.provinceName,
          input.wardCode,
          input.wardName,
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
