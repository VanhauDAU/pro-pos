import type { AccessAuthPurpose } from '@contracts/auth';

export interface AccessAuthRequestRow {
  id: string;
  purpose: AccessAuthPurpose;
  target_device_id: string | null;
  status: 'PENDING' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
  expires_at: number;
  access_email: string | null;
  access_subject: string | null;
  authorization_code_hash: string | null;
}

export interface AccessIdentityRow {
  user_id: string;
  email: string;
  subject: string | null;
  credential_version: number;
  display_name: string;
  user_status: 'ACTIVE' | 'DISABLED';
  platform_role: 'SUPER_ADMIN' | null;
  store_id: string | null;
  store_status: 'ACTIVE' | 'LOCKED' | null;
  membership_status: 'ACTIVE' | 'DISABLED' | null;
  role_code: string | null;
}

export class AccessAuthRepository {
  constructor(private readonly db: D1Database) {}

  async createRequest(input: {
    id: string;
    tokenHash: string;
    purpose: AccessAuthPurpose;
    targetDeviceId: string | null;
    expiresAt: number;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO access_auth_requests (
          id, token_hash, purpose, target_device_id, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
      )
      .bind(
        input.id,
        input.tokenHash,
        input.purpose,
        input.targetDeviceId,
        input.expiresAt,
        input.now,
      )
      .run();
  }

  findRequestByHash(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT id, purpose, target_device_id, status, expires_at,
                access_email, access_subject, authorization_code_hash
         FROM access_auth_requests WHERE token_hash = ? LIMIT 1`,
      )
      .bind(tokenHash)
      .first<AccessAuthRequestRow>();
  }

  findRequestById(id: string) {
    return this.db
      .prepare(
        `SELECT id, purpose, target_device_id, status, expires_at,
                access_email, access_subject, authorization_code_hash
         FROM access_auth_requests WHERE id = ? LIMIT 1`,
      )
      .bind(id)
      .first<AccessAuthRequestRow>();
  }

  async authorizeRequest(input: {
    id: string;
    email: string;
    subject: string | null;
    codeHash: string;
    now: number;
  }) {
    return this.db
      .prepare(
        `UPDATE access_auth_requests
         SET access_email = ?, access_subject = ?, authorization_code_hash = ?, authorized_at = ?
         WHERE id = ? AND status = 'PENDING' AND expires_at > ?
           AND authorization_code_hash IS NULL`,
      )
      .bind(input.email, input.subject, input.codeHash, input.now, input.id, input.now)
      .run();
  }

  async consumeRequest(id: string, now: number) {
    return this.db
      .prepare(
        `UPDATE access_auth_requests
         SET status = 'CONSUMED', consumed_at = ?
         WHERE id = ? AND status = 'PENDING' AND expires_at > ?`,
      )
      .bind(now, id, now)
      .run();
  }

  async expireRequest(id: string) {
    await this.db
      .prepare(
        `UPDATE access_auth_requests SET status = 'EXPIRED'
         WHERE id = ? AND status = 'PENDING'`,
      )
      .bind(id)
      .run();
  }

  findIdentityByEmail(email: string) {
    return this.db
      .prepare(
        `SELECT
          ai.user_id, ai.email, ai.subject, ai.credential_version,
          u.display_name, u.status AS user_status, u.platform_role,
          sm.store_id, sm.status AS membership_status,
          s.status AS store_status, r.code AS role_code
        FROM access_identities ai
        JOIN users u ON u.id = ai.user_id
        LEFT JOIN store_memberships sm ON sm.user_id = u.id
        LEFT JOIN stores s ON s.id = sm.store_id
        LEFT JOIN roles r ON r.id = sm.role_id AND r.store_id = sm.store_id
        WHERE ai.email = ? COLLATE NOCASE
        ORDER BY CASE WHEN r.code = 'OWNER' THEN 0 ELSE 1 END
        LIMIT 1`,
      )
      .bind(email)
      .first<AccessIdentityRow>();
  }

  async bindSubjectIfMissing(userId: string, subject: string, now: number) {
    return this.db
      .prepare(
        `UPDATE access_identities SET subject = ?, updated_at = ?
         WHERE user_id = ? AND subject IS NULL`,
      )
      .bind(subject, now, userId)
      .run();
  }
}
