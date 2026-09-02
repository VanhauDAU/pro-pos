import type {
  ActivationConfirmationResponse,
  AuthContextResponse,
  LoginResponse,
} from '@contracts/auth';
import { AppError } from '@server/lib/app-error';
import {
  DEFAULT_PASSWORD_WORK_FACTOR,
  deriveCsrfToken,
  deriveDeterministicSecret,
  derivePasswordDigest,
  hashOpaqueToken,
  randomOpaqueToken,
  randomSalt,
  verifyPasswordDigest,
  verifyPinDigest,
} from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import {
  AuthRepository,
  type DeviceContextRow,
  type PrincipalContextRow,
} from '@server/repositories/auth-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';
import type { RequestPrincipal } from '@server/types';

const EMPLOYEE_REMEMBER_SESSION_MAX_HOURS = 30 * 24;
const OWNER_SHORT_ABSOLUTE_SECONDS = 24 * 60 * 60;
const OWNER_SHORT_IDLE_SECONDS = 12 * 60 * 60;
const OWNER_LONG_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
const OWNER_LONG_IDLE_SECONDS = 7 * 24 * 60 * 60;
const PLATFORM_IDLE_SECONDS = 60 * 60;
const PLATFORM_ABSOLUTE_SECONDS = 24 * 60 * 60;
const DEVICE_SECONDS = 365 * 24 * 60 * 60;

export class AuthService {
  private readonly repository: AuthRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new AuthRepository(env.DB);
  }

  private get authPepper() {
    return requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER');
  }

  private get deviceTokenPepper() {
    return requireSecret(this.env.DEVICE_TOKEN_PEPPER, 'DEVICE_TOKEN_PEPPER');
  }

  private get sessionTokenPepper() {
    return requireSecret(this.env.SESSION_TOKEN_PEPPER, 'SESSION_TOKEN_PEPPER');
  }

  private async assertNotLocked(scope: string, subjectKey: string, now: number) {
    const attempt = await this.repository.findAttempt(scope, subjectKey);
    if (attempt?.locked_until && attempt.locked_until > now) {
      throw new AppError('AUTH_RATE_LIMITED', 'Vui lòng thử lại sau.', 429, {
        retryAfterSeconds: Math.ceil((attempt.locked_until - now) / 1000),
      });
    }
  }

  private async ownerPasswordSubject(identifier: string, rateLimitClientKey?: string) {
    const clientPartition = await hashOpaqueToken(
      `owner-password:${rateLimitClientKey?.trim() || 'unknown-client'}`,
      this.authPepper,
    );
    return `owner:${identifier}:${clientPartition}`;
  }

  async ownerLogin(input: {
    username: string;
    password: string;
    rememberMe?: boolean | undefined;
    rateLimitClientKey?: string | undefined;
  }): Promise<{ rawToken: string; maxAgeSeconds: number; response: LoginResponse }> {
    const now = Date.now();
    const normalizedIdentifier = input.username.trim().toLocaleLowerCase('en-US');
    const subjectKey = await this.ownerPasswordSubject(
      normalizedIdentifier,
      input.rateLimitClientKey,
    );
    await this.assertNotLocked('OWNER_PASSWORD', subjectKey, now);

    const identity = await this.repository.findOwnerByUsernameOrEmail(normalizedIdentifier);
    let valid = false;
    if (identity && identity.digest && identity.salt) {
      valid = await verifyPasswordDigest({
        password: input.password,
        salt: identity.salt,
        pepper: this.authPepper,
        expectedDigest: identity.digest,
        workFactor: identity.work_factor ?? DEFAULT_PASSWORD_WORK_FACTOR,
      });
    }

    if (
      !identity ||
      !valid ||
      identity.user_status !== 'ACTIVE' ||
      identity.membership_status !== 'ACTIVE'
    ) {
      await this.repository.recordFailure('OWNER_PASSWORD', subjectKey, now);
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Tên đăng nhập hoặc mật khẩu không chính xác.',
        401,
      );
    }
    if (identity.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
    }

    await this.repository.clearFailures('OWNER_PASSWORD', subjectKey);
    const rawToken = randomOpaqueToken();
    const absoluteSeconds = input.rememberMe
      ? OWNER_LONG_ABSOLUTE_SECONDS
      : OWNER_SHORT_ABSOLUTE_SECONDS;
    const idleSeconds = input.rememberMe ? OWNER_LONG_IDLE_SECONDS : OWNER_SHORT_IDLE_SECONDS;

    await this.repository.createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(rawToken, this.sessionTokenPepper),
      userId: identity.user_id,
      storeId: identity.store_id,
      deviceId: null,
      kind: 'OWNER',
      credentialVersion: identity.credential_version ?? 1,
      expiresAt: now + absoluteSeconds * 1000,
      idleExpiresAt: now + idleSeconds * 1000,
      now,
    });

    return {
      rawToken,
      maxAgeSeconds: absoluteSeconds,
      response: {
        actor: {
          id: identity.user_id,
          displayName: identity.display_name,
          kind: 'OWNER',
          storeId: identity.store_id,
        },
        csrfToken: await deriveCsrfToken(rawToken, this.authPepper),
      },
    };
  }

  async platformLogin(input: {
    username: string;
    password: string;
  }): Promise<{ rawToken: string; response: LoginResponse }> {
    const now = Date.now();
    const normalizedIdentifier = input.username.trim().toLocaleLowerCase('en-US');
    const subjectKey = `platform:${normalizedIdentifier}`;
    await this.assertNotLocked('PLATFORM_PASSWORD', subjectKey, now);

    const identity = await this.repository.findSuperAdminByUsernameOrEmail(normalizedIdentifier);
    let valid = false;
    if (identity && identity.digest && identity.salt) {
      valid = await verifyPasswordDigest({
        password: input.password,
        salt: identity.salt,
        pepper: this.authPepper,
        expectedDigest: identity.digest,
        workFactor: identity.work_factor ?? DEFAULT_PASSWORD_WORK_FACTOR,
      });
    }

    if (!identity || !valid || identity.user_status !== 'ACTIVE') {
      await this.repository.recordFailure('PLATFORM_PASSWORD', subjectKey, now);
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Tên đăng nhập hoặc mật khẩu không chính xác.',
        401,
      );
    }

    await this.repository.clearFailures('PLATFORM_PASSWORD', subjectKey);
    const rawToken = randomOpaqueToken();
    await this.repository.createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(rawToken, this.sessionTokenPepper),
      userId: identity.user_id,
      storeId: null,
      deviceId: null,
      kind: 'SUPER_ADMIN',
      credentialVersion: identity.credential_version ?? 1,
      expiresAt: now + PLATFORM_ABSOLUTE_SECONDS * 1000,
      idleExpiresAt: now + PLATFORM_IDLE_SECONDS * 1000,
      now,
    });

    return {
      rawToken,
      response: {
        actor: {
          id: identity.user_id,
          displayName: identity.display_name,
          kind: 'SUPER_ADMIN',
          storeId: null,
        },
        csrfToken: await deriveCsrfToken(rawToken, this.authPepper),
      },
    };
  }

  async directDeviceActivation(input: {
    username: string;
    password: string;
    deviceName: string;
    rateLimitClientKey?: string | undefined;
  }): Promise<{ rawDeviceSecret: string; response: ActivationConfirmationResponse }> {
    const now = Date.now();
    const normalizedIdentifier = input.username.trim().toLocaleLowerCase('en-US');
    const subjectKey = await this.ownerPasswordSubject(
      normalizedIdentifier,
      input.rateLimitClientKey,
    );
    await this.assertNotLocked('OWNER_PASSWORD', subjectKey, now);

    const identity = await this.repository.findOwnerByUsernameOrEmail(normalizedIdentifier);
    let valid = false;
    if (identity && identity.digest && identity.salt) {
      valid = await verifyPasswordDigest({
        password: input.password,
        salt: identity.salt,
        pepper: this.authPepper,
        expectedDigest: identity.digest,
        workFactor: identity.work_factor ?? DEFAULT_PASSWORD_WORK_FACTOR,
      });
    }

    if (
      !identity ||
      !valid ||
      identity.user_status !== 'ACTIVE' ||
      identity.membership_status !== 'ACTIVE'
    ) {
      await this.repository.recordFailure('OWNER_PASSWORD', subjectKey, now);
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Tài khoản hoặc mật khẩu Chủ cửa hàng không đúng.',
        401,
      );
    }
    if (identity.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
    }

    await this.repository.clearFailures('OWNER_PASSWORD', subjectKey);
    const deviceId = crypto.randomUUID();
    const rawDeviceSecret = randomOpaqueToken();
    const secretHash = await hashOpaqueToken(rawDeviceSecret, this.deviceTokenPepper);
    const deviceName = input.deviceName.trim() || 'Máy POS';

    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO devices (id, store_id, name, status, activated_by, activated_at, created_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      ).bind(deviceId, identity.store_id, deviceName, identity.user_id, now, now, now),
      this.env.DB.prepare(
        `INSERT INTO device_credentials (device_id, secret_hash, pepper_version, credential_version, issued_at, expires_at)
         VALUES (?, ?, 1, 1, ?, ?)`,
      ).bind(deviceId, secretHash, now, now + DEVICE_SECONDS * 1000),
    ]);

    return {
      rawDeviceSecret,
      response: {
        device: {
          id: deviceId,
          name: deviceName,
          status: 'ACTIVE',
          storeId: identity.store_id,
        },
      },
    };
  }

  async changePassword(input: {
    userId: string;
    currentPassword?: string;
    newPassword: string;
  }): Promise<{ success: boolean }> {
    const now = Date.now();
    const cred = await this.repository.findPasswordCredential(input.userId);
    if (cred && input.currentPassword) {
      const valid = await verifyPasswordDigest({
        password: input.currentPassword,
        salt: cred.salt,
        pepper: this.authPepper,
        expectedDigest: cred.digest,
        workFactor: cred.work_factor,
      });
      if (!valid) {
        throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng.', 400);
      }
    }

    const salt = randomSalt(16);
    const digest = await derivePasswordDigest({
      password: input.newPassword,
      salt,
      pepper: this.authPepper,
      workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
    });
    await this.repository.savePasswordCredential({
      userId: input.userId,
      salt,
      digest,
      workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
      pepperVersion: 1,
      now,
    });
    return { success: true };
  }

  async confirmActivation(input: {
    rawGrant: string;
    idempotencyKey: string;
    deviceName: string;
  }): Promise<{ rawDeviceSecret: string; response: ActivationConfirmationResponse }> {
    const now = Date.now();
    const grantHash = await hashOpaqueToken(input.rawGrant, this.authPepper);
    const grant = await this.repository.findActivationGrantByHash(grantHash);
    if (!grant) {
      throw new AppError('ACTIVATION_GRANT_REQUIRED', 'Cần xác thực lại Chủ cửa hàng.', 401);
    }
    if (grant.expires_at <= now) {
      await this.repository.markGrantExpired(grant.id);
      throw new AppError('ACTIVATION_GRANT_EXPIRED', 'Phiên kích hoạt đã hết hạn.', 401);
    }
    if (grant.owner_status !== 'ACTIVE' || grant.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Không thể kích hoạt thiết bị.', 403);
    }
    if (grant.status === 'CONSUMED' && grant.idempotency_key !== input.idempotencyKey) {
      throw new AppError('ACTIVATION_GRANT_USED', 'Phiên kích hoạt đã được sử dụng.', 409);
    }
    if (grant.status !== 'PENDING' && grant.status !== 'CONSUMED') {
      throw new AppError('ACTIVATION_GRANT_USED', 'Phiên kích hoạt không còn hợp lệ.', 409);
    }

    const rawDeviceSecret = await deriveDeterministicSecret(
      input.rawGrant,
      input.idempotencyKey,
      this.deviceTokenPepper,
    );
    const secretHash = await hashOpaqueToken(rawDeviceSecret, this.deviceTokenPepper);
    await this.repository.confirmActivation({
      grantId: grant.id,
      idempotencyKey: input.idempotencyKey,
      deviceName: input.deviceName.trim(),
      secretHash,
      expiresAt: now + DEVICE_SECONDS * 1000,
      now,
    });
    const confirmed = await this.repository.findActivationGrantByHash(grantHash);
    if (!confirmed || confirmed.idempotency_key !== input.idempotencyKey) {
      throw new AppError('ACTIVATION_GRANT_USED', 'Phiên kích hoạt đã được sử dụng.', 409);
    }
    return {
      rawDeviceSecret,
      response: {
        device: {
          id: grant.id,
          name: confirmed.device_name ?? input.deviceName.trim(),
          status: 'ACTIVE',
          storeId: grant.store_id,
        },
      },
    };
  }

  async cancelActivation(rawGrant: string) {
    await this.repository.cancelGrantByHash(await hashOpaqueToken(rawGrant, this.authPepper));
    return { cancelled: true };
  }

  async activationContext(rawGrant: string) {
    const now = Date.now();
    const grant = await this.repository.findActivationGrantByHash(
      await hashOpaqueToken(rawGrant, this.authPepper),
    );
    if (!grant || grant.status !== 'PENDING') {
      throw new AppError('ACTIVATION_GRANT_REQUIRED', 'Cần xác thực lại Chủ cửa hàng.', 401);
    }
    if (grant.expires_at <= now) {
      await this.repository.markGrantExpired(grant.id);
      throw new AppError('ACTIVATION_GRANT_EXPIRED', 'Phiên kích hoạt đã hết hạn.', 401);
    }
    if (grant.owner_status !== 'ACTIVE' || grant.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Không thể kích hoạt thiết bị.', 403);
    }
    return {
      expiresInSeconds: Math.max(1, Math.ceil((grant.expires_at - now) / 1000)),
      csrfToken: await deriveCsrfToken(rawGrant, this.authPepper),
    };
  }

  async listDevices(storeId: string) {
    const result = await this.repository.listDevices(storeId);
    return result.results;
  }

  async revokeDevice(storeId: string, deviceId: string, auditContext?: AuditContext) {
    const now = Date.now();
    const before = auditContext ? await this.repository.findDevice(storeId, deviceId) : null;
    const result = await this.repository.revokeDevice(storeId, deviceId, now);
    if ((result[0]?.meta.changes ?? 0) !== 1) {
      throw new AppError('DEVICE_NOT_FOUND', 'Không tìm thấy thiết bị đang hoạt động.', 404);
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'DEVICE_REVOKED',
        entityType: 'DEVICE',
        entityId: deviceId,
        before,
        after: { status: 'REVOKED', revokedAt: now },
        now,
      });
    }
    return { deviceId, status: 'REVOKED' as const };
  }

  async employeeLogin(input: {
    rawDeviceSecret: string;
    username: string;
    pin: string;
  }): Promise<{ rawToken: string; maxAgeSeconds: number; response: LoginResponse }> {
    const now = Date.now();
    const device = await this.resolveDevice(input.rawDeviceSecret);
    if (!device) {
      throw new AppError('DEVICE_CREDENTIAL_INVALID', 'Thiết bị POS không hợp lệ.', 401);
    }
    if (device.device_status === 'REVOKED') {
      throw new AppError('DEVICE_REVOKED', 'Thiết bị POS đã bị thu hồi.', 403);
    }
    if (device.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
    }
    const normalizedUsername = input.username.trim().toLocaleLowerCase('en-US');
    const subjectKey = `pin:${device.device_id}:${normalizedUsername}`;
    await this.assertNotLocked('EMPLOYEE_PIN', subjectKey, now);
    const identity = await this.repository.findEmployeeByUsernameAndStore(
      normalizedUsername,
      device.store_id,
    );
    const valid = await verifyPinDigest({
      pin: input.pin,
      pepper: this.authPepper,
      salt: identity?.salt ?? 'AAAAAAAAAAAAAAAAAAAAAA',
      userId: identity?.user_id ?? '00000000-0000-0000-0000-000000000000',
      storeId: device.store_id,
      expectedDigest: identity?.digest ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    if (
      !identity ||
      !valid ||
      identity.user_status !== 'ACTIVE' ||
      identity.membership_status !== 'ACTIVE'
    ) {
      await this.repository.recordFailure('EMPLOYEE_PIN', subjectKey, now);
      throw new AppError('INVALID_CREDENTIALS', 'Thông tin đăng nhập không hợp lệ.', 401);
    }
    await this.repository.clearFailures('EMPLOYEE_PIN', subjectKey);
    const rawToken = randomOpaqueToken();
    const rememberSessionHours = Math.min(
      EMPLOYEE_REMEMBER_SESSION_MAX_HOURS,
      Math.max(1, identity.employee_remember_session_hours),
    );
    const maxAgeSeconds = rememberSessionHours * 60 * 60;
    await this.repository.createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(rawToken, this.sessionTokenPepper),
      userId: identity.user_id,
      storeId: device.store_id,
      deviceId: device.device_id,
      kind: 'EMPLOYEE',
      credentialVersion: identity.credential_version,
      expiresAt: now + maxAgeSeconds * 1000,
      idleExpiresAt: now + maxAgeSeconds * 1000,
      now,
    });
    return {
      rawToken,
      maxAgeSeconds,
      response: {
        actor: {
          id: identity.user_id,
          displayName: identity.display_name,
          kind: 'EMPLOYEE',
          storeId: device.store_id,
        },
        csrfToken: await deriveCsrfToken(rawToken, this.authPepper),
      },
    };
  }

  async resolveDevice(rawSecret?: string): Promise<DeviceContextRow | null> {
    if (!rawSecret) return null;
    const secretHash = await hashOpaqueToken(rawSecret, this.deviceTokenPepper);
    return this.repository.findDeviceBySecretHash(secretHash);
  }

  private async resolvePrincipalContext(rawSession?: string, rawDevice?: string) {
    if (!rawSession && !rawDevice) {
      return { principal: null, device: null };
    }
    const [sessionHash, deviceHash] = await Promise.all([
      rawSession ? hashOpaqueToken(rawSession, this.sessionTokenPepper) : Promise.resolve(null),
      rawDevice ? hashOpaqueToken(rawDevice, this.deviceTokenPepper) : Promise.resolve(null),
    ]);
    const now = Date.now();
    const row = await this.repository.findPrincipalContext({ sessionHash, deviceHash, now });
    const device = this.deviceFromPrincipalRow(row);
    if (!rawSession || !row?.session_id) return { principal: null, device };

    const sessionValid =
      row.session_status === 'ACTIVE' &&
      row.user_status === 'ACTIVE' &&
      row.current_credential_version === row.session_credential_version &&
      row.expires_at > now &&
      row.idle_expires_at > now;
    const employeeDeviceValid =
      row.session_kind !== 'EMPLOYEE' ||
      (device?.status === 'ACTIVE' &&
        row.session_device_id === device.id &&
        row.store_id === device.storeId);
    if (!sessionValid || !employeeDeviceValid) return { principal: null, device };

    if (now - row.last_seen_at > 5 * 60_000) {
      const idleSeconds =
        row.session_kind === 'EMPLOYEE'
          ? Math.min(
              EMPLOYEE_REMEMBER_SESSION_MAX_HOURS,
              Math.max(1, row.employee_remember_session_hours ?? 12),
            ) *
            60 *
            60
          : row.session_kind === 'SUPER_ADMIN'
            ? PLATFORM_IDLE_SECONDS
            : OWNER_LONG_IDLE_SECONDS;
      await this.repository.touchSession(
        row.session_id,
        now,
        Math.min(row.expires_at, now + idleSeconds * 1000),
      );
    }

    const permissionKeys = row.permission_keys?.split('\u001f').filter(Boolean) ?? [];
    const principal: RequestPrincipal = {
      actor: {
        id: row.user_id,
        displayName: row.display_name,
        kind: row.session_kind,
        storeId: row.store_id,
      },
      device,
      sessionId: row.session_id,
      storeStatus: row.store_status,
      permissions: new Set(permissionKeys),
    };
    return { principal, device };
  }

  private deviceFromPrincipalRow(row: PrincipalContextRow | null): RequestPrincipal['device'] {
    if (!row?.device_id || !row.device_name || !row.device_status || !row.device_store_id) {
      return null;
    }
    return {
      id: row.device_id,
      name: row.device_name,
      status: row.device_status,
      storeId: row.device_store_id,
      ...(row.device_store_name ? { storeName: row.device_store_name } : {}),
    };
  }

  async requestPrincipal(rawSession: string, rawDevice?: string): Promise<RequestPrincipal | null> {
    return (await this.resolvePrincipalContext(rawSession, rawDevice)).principal;
  }

  async applicationContext(
    rawSession?: string,
    rawDevice?: string,
  ): Promise<{
    context: AuthContextResponse & { sessionId: string | null };
    principal: RequestPrincipal | null;
  }> {
    const resolved = await this.resolvePrincipalContext(rawSession, rawDevice);
    const actor = resolved.principal?.actor ?? null;
    const csrfToken =
      rawSession && actor ? await deriveCsrfToken(rawSession, this.authPepper) : null;
    const sessionId = resolved.principal?.sessionId ?? null;
    const device = resolved.device;

    const allowedEntrypoints: AuthContextResponse['allowedEntrypoints'] = [];
    if (actor?.kind === 'OWNER') allowedEntrypoints.push('OWNER');
    if (actor?.kind === 'SUPER_ADMIN') allowedEntrypoints.push('PLATFORM');
    if (device?.status === 'ACTIVE') allowedEntrypoints.push('EMPLOYEE');

    return {
      context: {
        actor,
        device,
        allowedEntrypoints,
        csrfToken,
        sessionId,
      },
      principal: resolved.principal,
    };
  }

  async context(
    rawSession?: string,
    rawDevice?: string,
  ): Promise<AuthContextResponse & { sessionId: string | null }> {
    return (await this.applicationContext(rawSession, rawDevice)).context;
  }

  async logout(rawSession: string) {
    const tokenHash = await hashOpaqueToken(rawSession, this.sessionTokenPepper);
    await this.repository.revokeSessionByHash(tokenHash, Date.now());
  }
}
