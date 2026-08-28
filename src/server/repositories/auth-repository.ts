export interface PinIdentityRow {
  user_id: string;
  display_name: string;
  user_status: 'ACTIVE' | 'DISABLED';
  store_id: string;
  membership_status: 'ACTIVE' | 'DISABLED';
  employee_remember_session_hours: number;
  algorithm: 'HMAC-SHA256-PEPPERED';
  salt: string;
  digest: string;
  pepper_version: number;
  credential_version: number;
}

export interface OwnerPasswordIdentityRow {
  user_id: string;
  display_name: string;
  user_status: 'ACTIVE' | 'DISABLED';
  store_id: string;
  store_status: 'ACTIVE' | 'LOCKED';
  membership_status: 'ACTIVE' | 'DISABLED';
  algorithm: 'PBKDF2-HMAC-SHA256' | null;
  salt: string | null;
  digest: string | null;
  work_factor: number | null;
  pepper_version: number | null;
  credential_version: number | null;
}

export interface SuperAdminPasswordIdentityRow {
  user_id: string;
  display_name: string;
  user_status: 'ACTIVE' | 'DISABLED';
  algorithm: 'PBKDF2-HMAC-SHA256' | null;
  salt: string | null;
  digest: string | null;
  work_factor: number | null;
  pepper_version: number | null;
  credential_version: number | null;
}

export interface DeviceContextRow {
  device_id: string;
  device_name: string;
  device_status: 'ACTIVE' | 'REVOKED';
  store_id: string;
  store_name: string;
  store_status: 'ACTIVE' | 'LOCKED';
  credential_version: number;
}

export interface SessionContextRow {
  session_id: string;
  user_id: string;
  display_name: string;
  user_status: 'ACTIVE' | 'DISABLED';
  store_id: string | null;
  session_device_id: string | null;
  employee_remember_session_hours: number | null;
  session_kind: 'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE';
  session_status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  expires_at: number;
  idle_expires_at: number;
  last_seen_at: number;
  session_credential_version: number;
  current_credential_version: number | null;
}

export interface ActivationGrantRow {
  id: string;
  store_id: string;
  owner_user_id: string;
  status: 'PENDING' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';
  idempotency_key: string | null;
  device_name: string | null;
  expires_at: number;
  owner_status: 'ACTIVE' | 'DISABLED';
  store_status: 'ACTIVE' | 'LOCKED';
}

export class AuthRepository {
  constructor(private readonly db: D1Database) {}

  findOwnerByUsernameOrEmail(identifier: string) {
    return this.db
      .prepare(
        `SELECT
          u.id AS user_id, u.display_name, u.status AS user_status,
          s.id AS store_id, s.status AS store_status,
          sm.status AS membership_status,
          pc.algorithm, pc.salt, pc.digest, pc.work_factor,
          pc.pepper_version, pc.credential_version
        FROM users u
        JOIN store_memberships sm ON sm.user_id = u.id
        JOIN roles r ON r.id = sm.role_id AND r.code = 'OWNER'
        JOIN stores s ON s.id = sm.store_id
        LEFT JOIN password_credentials pc ON pc.user_id = u.id
        WHERE (u.username = ? COLLATE NOCASE OR u.email = ? COLLATE NOCASE)
        LIMIT 1`,
      )
      .bind(identifier, identifier)
      .first<OwnerPasswordIdentityRow>();
  }

  findSuperAdminByUsernameOrEmail(identifier: string) {
    return this.db
      .prepare(
        `SELECT
          u.id AS user_id, u.display_name, u.status AS user_status,
          pc.algorithm, pc.salt, pc.digest, pc.work_factor,
          pc.pepper_version, pc.credential_version
        FROM users u
        LEFT JOIN password_credentials pc ON pc.user_id = u.id
        WHERE u.platform_role = 'SUPER_ADMIN'
          AND (u.username = ? COLLATE NOCASE OR u.email = ? COLLATE NOCASE)
        LIMIT 1`,
      )
      .bind(identifier, identifier)
      .first<SuperAdminPasswordIdentityRow>();
  }

  findPasswordCredential(userId: string) {
    return this.db
      .prepare(
        `SELECT algorithm, work_factor, salt, digest, pepper_version, credential_version
         FROM password_credentials WHERE user_id = ? LIMIT 1`,
      )
      .bind(userId)
      .first<{
        algorithm: 'PBKDF2-HMAC-SHA256';
        work_factor: number;
        salt: string;
        digest: string;
        pepper_version: number;
        credential_version: number;
      }>();
  }

  async savePasswordCredential(input: {
    userId: string;
    salt: string;
    digest: string;
    workFactor: number;
    pepperVersion: number;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO password_credentials (
          user_id, algorithm, work_factor, salt, digest, pepper_version, credential_version, updated_at
        ) VALUES (?, 'PBKDF2-HMAC-SHA256', ?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          algorithm = excluded.algorithm,
          work_factor = excluded.work_factor,
          salt = excluded.salt,
          digest = excluded.digest,
          pepper_version = excluded.pepper_version,
          credential_version = credential_version + 1,
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.userId,
        input.workFactor,
        input.salt,
        input.digest,
        input.pepperVersion,
        input.now,
      )
      .run();
  }

  findEmployeeByUsernameAndStore(username: string, storeId: string) {
    return this.db
      .prepare(
        `SELECT
          u.id AS user_id, u.display_name, u.status AS user_status,
          sm.store_id, sm.status AS membership_status,
          COALESCE(ss.employee_remember_session_hours, 12) AS employee_remember_session_hours,
          pc.algorithm, pc.salt, pc.digest,
          pc.pepper_version, pc.credential_version
        FROM users u
        JOIN store_memberships sm ON sm.user_id = u.id AND sm.store_id = ?
        LEFT JOIN store_settings ss ON ss.store_id = sm.store_id
        JOIN pin_verifiers pc ON pc.user_id = u.id AND pc.store_id = sm.store_id
        WHERE u.username = ? COLLATE NOCASE
        LIMIT 1`,
      )
      .bind(storeId, username)
      .first<PinIdentityRow>();
  }

  async createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    storeId: string | null;
    deviceId: string | null;
    kind: 'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE';
    credentialVersion: number;
    expiresAt: number;
    idleExpiresAt: number;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO auth_sessions (
          id, token_hash, user_id, store_id, device_id, session_kind, status,
          credential_version, expires_at, idle_expires_at, last_seen_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.tokenHash,
        input.userId,
        input.storeId,
        input.deviceId,
        input.kind,
        input.credentialVersion,
        input.expiresAt,
        input.idleExpiresAt,
        input.now,
        input.now,
      )
      .run();
  }

  findSessionByHash(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT
          s.id AS session_id, s.user_id, u.display_name, u.status AS user_status,
          s.store_id, s.device_id AS session_device_id, s.session_kind,
          ss.employee_remember_session_hours,
          s.status AS session_status, s.expires_at, s.idle_expires_at, s.last_seen_at,
          s.credential_version AS session_credential_version,
          CASE
            WHEN s.session_kind = 'EMPLOYEE' THEN pv.credential_version
            WHEN s.session_kind = 'OWNER' THEN COALESCE(pc.credential_version, ai.credential_version, s.credential_version)
            WHEN s.session_kind = 'SUPER_ADMIN' THEN COALESCE(pc.credential_version, ai.credential_version, s.credential_version)
            ELSE s.credential_version
          END AS current_credential_version
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN store_settings ss ON ss.store_id = s.store_id
        LEFT JOIN password_credentials pc ON pc.user_id = s.user_id
        LEFT JOIN access_identities ai ON ai.user_id = s.user_id
        LEFT JOIN pin_verifiers pv ON pv.user_id = s.user_id
        WHERE s.token_hash = ?
        LIMIT 1`,
      )
      .bind(tokenHash)
      .first<SessionContextRow>();
  }

  async touchSession(sessionId: string, lastSeenAt: number, idleExpiresAt: number) {
    await this.db
      .prepare(
        `UPDATE auth_sessions
         SET last_seen_at = ?, idle_expires_at = ?
         WHERE id = ? AND status = 'ACTIVE'`,
      )
      .bind(lastSeenAt, idleExpiresAt, sessionId)
      .run();
  }

  async revokeSessionByHash(tokenHash: string, now: number) {
    await this.db
      .prepare(
        `UPDATE auth_sessions
         SET status = 'REVOKED', revoked_at = ?
         WHERE token_hash = ? AND status = 'ACTIVE'`,
      )
      .bind(now, tokenHash)
      .run();
  }

  findDeviceBySecretHash(secretHash: string) {
    return this.db
      .prepare(
        `SELECT
          d.id AS device_id, d.name AS device_name, d.status AS device_status,
          d.store_id, s.name AS store_name, s.status AS store_status,
          dc.credential_version
        FROM device_credentials dc
        JOIN devices d ON d.id = dc.device_id
        JOIN stores s ON s.id = d.store_id
        WHERE dc.secret_hash = ? AND dc.expires_at > ?
        LIMIT 1`,
      )
      .bind(secretHash, Date.now())
      .first<DeviceContextRow>();
  }

  async createActivationGrant(input: {
    id: string;
    tokenHash: string;
    storeId: string;
    ownerUserId: string;
    expiresAt: number;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO activation_grants (
          id, token_hash, store_id, owner_user_id, scope, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, 'ACTIVATE_DEVICE', 'PENDING', ?, ?)`,
      )
      .bind(input.id, input.tokenHash, input.storeId, input.ownerUserId, input.expiresAt, input.now)
      .run();
  }

  findActivationGrantByHash(tokenHash: string) {
    return this.db
      .prepare(
        `SELECT
          ag.id, ag.store_id, ag.owner_user_id, ag.status, ag.idempotency_key,
          ag.device_name, ag.expires_at, u.status AS owner_status, s.status AS store_status
        FROM activation_grants ag
        JOIN users u ON u.id = ag.owner_user_id
        JOIN stores s ON s.id = ag.store_id
        WHERE ag.token_hash = ?
        LIMIT 1`,
      )
      .bind(tokenHash)
      .first<ActivationGrantRow>();
  }

  async confirmActivation(input: {
    grantId: string;
    idempotencyKey: string;
    deviceName: string;
    secretHash: string;
    expiresAt: number;
    now: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE activation_grants
           SET status = 'CONSUMED', consumed_at = ?, idempotency_key = ?, device_name = ?
           WHERE id = ? AND status = 'PENDING' AND expires_at > ?`,
        )
        .bind(input.now, input.idempotencyKey, input.deviceName, input.grantId, input.now),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO devices (
            id, store_id, name, status, activated_by, activated_at,
            created_at, updated_at
          )
          SELECT id, store_id, device_name, 'ACTIVE', owner_user_id, ?, ?, ?
          FROM activation_grants
          WHERE id = ? AND status = 'CONSUMED' AND idempotency_key = ?`,
        )
        .bind(input.now, input.now, input.now, input.grantId, input.idempotencyKey),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO device_credentials (
            device_id, secret_hash, pepper_version, credential_version,
            issued_at, expires_at
          )
          SELECT id, ?, 1, 1, ?, ?
          FROM activation_grants
          WHERE id = ? AND status = 'CONSUMED' AND idempotency_key = ?`,
        )
        .bind(input.secretHash, input.now, input.expiresAt, input.grantId, input.idempotencyKey),
    ]);
  }

  async markGrantExpired(grantId: string) {
    await this.db
      .prepare(
        `UPDATE activation_grants
         SET status = 'EXPIRED'
         WHERE id = ? AND status = 'PENDING'`,
      )
      .bind(grantId)
      .run();
  }

  async cancelGrantByHash(tokenHash: string) {
    await this.db
      .prepare(
        `UPDATE activation_grants SET status = 'CANCELLED'
         WHERE token_hash = ? AND status = 'PENDING'`,
      )
      .bind(tokenHash)
      .run();
  }

  findDeviceById(storeId: string, deviceId: string) {
    return this.db
      .prepare(
        `SELECT id, store_id AS storeId, name, status
         FROM devices WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(deviceId, storeId)
      .first<{ id: string; storeId: string; name: string; status: 'ACTIVE' | 'REVOKED' }>();
  }

  async listDevices(storeId: string) {
    return this.db
      .prepare(
        `SELECT id, name, status, activated_at AS activatedAt,
                revoked_at AS revokedAt, last_seen_at AS lastSeenAt
         FROM devices WHERE store_id = ? ORDER BY created_at DESC`,
      )
      .bind(storeId)
      .all();
  }

  findDevice(storeId: string, deviceId: string) {
    return this.db
      .prepare(
        `SELECT id, name, status, activated_at AS activatedAt, revoked_at AS revokedAt
         FROM devices WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, deviceId)
      .first();
  }

  async reissueDeviceCredential(input: {
    storeId: string;
    deviceId: string;
    secretHash: string;
    now: number;
    expiresAt: number;
  }) {
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE devices SET status = 'ACTIVE', revoked_at = NULL, updated_at = ?
           WHERE id = ? AND store_id = ?`,
        )
        .bind(input.now, input.deviceId, input.storeId),
      this.db
        .prepare(
          `UPDATE device_credentials
           SET secret_hash = ?, credential_version = credential_version + 1,
               issued_at = ?, expires_at = ?, revoked_at = NULL
           WHERE device_id = ? AND EXISTS (
             SELECT 1 FROM devices
             WHERE devices.id = device_credentials.device_id AND devices.store_id = ?
           )`,
        )
        .bind(input.secretHash, input.now, input.expiresAt, input.deviceId, input.storeId),
      this.db
        .prepare(
          `UPDATE auth_sessions SET status = 'REVOKED', revoked_at = ?
           WHERE device_id = ? AND session_kind = 'EMPLOYEE' AND status = 'ACTIVE'
             AND EXISTS (
               SELECT 1 FROM devices
               WHERE devices.id = auth_sessions.device_id AND devices.store_id = ?
             )`,
        )
        .bind(input.now, input.deviceId, input.storeId),
    ]);
  }

  async revokeDevice(storeId: string, deviceId: string, now: number) {
    return this.db.batch([
      this.db
        .prepare(
          `UPDATE devices SET status = 'REVOKED', revoked_at = ?, updated_at = ?
           WHERE id = ? AND store_id = ? AND status = 'ACTIVE'`,
        )
        .bind(now, now, deviceId, storeId),
      this.db
        .prepare(
          `UPDATE device_credentials SET revoked_at = ?
           WHERE device_id = ? AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM devices
               WHERE devices.id = device_credentials.device_id AND devices.store_id = ?
             )`,
        )
        .bind(now, deviceId, storeId),
      this.db
        .prepare(
          `UPDATE auth_sessions SET status = 'REVOKED', revoked_at = ?
           WHERE device_id = ? AND session_kind = 'EMPLOYEE' AND status = 'ACTIVE'
             AND EXISTS (
               SELECT 1 FROM devices
               WHERE devices.id = auth_sessions.device_id AND devices.store_id = ?
             )`,
        )
        .bind(now, deviceId, storeId),
    ]);
  }

  async findAttempt(scope: string, subjectKey: string) {
    return this.db
      .prepare(
        `SELECT failure_count, window_started_at, locked_until
         FROM login_attempts WHERE scope = ? AND subject_key = ?`,
      )
      .bind(scope, subjectKey)
      .first<{ failure_count: number; window_started_at: number; locked_until: number | null }>();
  }

  async recordFailure(scope: string, subjectKey: string, now: number) {
    const existing = await this.findAttempt(scope, subjectKey);
    const windowExpired = !existing || now - existing.window_started_at > 10 * 60_000;
    const failureCount = windowExpired ? 1 : existing.failure_count + 1;
    const lockedUntil = failureCount >= 5 ? now + 15 * 60_000 : null;
    await this.db
      .prepare(
        `INSERT INTO login_attempts (
          scope, subject_key, failure_count, window_started_at, locked_until, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope, subject_key) DO UPDATE SET
          failure_count = excluded.failure_count,
          window_started_at = excluded.window_started_at,
          locked_until = excluded.locked_until,
          updated_at = excluded.updated_at`,
      )
      .bind(
        scope,
        subjectKey,
        failureCount,
        windowExpired ? now : existing.window_started_at,
        lockedUntil,
        now,
      )
      .run();
  }

  async clearFailures(scope: string, subjectKey: string) {
    await this.db
      .prepare('DELETE FROM login_attempts WHERE scope = ? AND subject_key = ?')
      .bind(scope, subjectKey)
      .run();
  }
}
