import type {
  ActivationConfirmationResponse,
  AuthContextResponse,
  LoginResponse,
} from '@contracts/auth';
import { AppError } from '@server/lib/app-error';
import {
  deriveCsrfToken,
  deriveDeterministicSecret,
  derivePasswordDigest,
  hashOpaqueToken,
  randomOpaqueToken,
  randomSalt,
  verifyPasswordDigest,
} from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import {
  AuthRepository,
  type DeviceContextRow,
  type PasswordIdentityRow,
} from '@server/repositories/auth-repository';

const OWNER_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
const OWNER_IDLE_SECONDS = 24 * 60 * 60;
const EMPLOYEE_ABSOLUTE_SECONDS = 12 * 60 * 60;
const EMPLOYEE_IDLE_SECONDS = 30 * 60;
const DEVICE_SECONDS = 365 * 24 * 60 * 60;
const ACTIVATION_SECONDS = 5 * 60;

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

  private async verifyOwnerCredentials(
    username: string,
    password: string,
  ): Promise<PasswordIdentityRow> {
    const now = Date.now();
    const normalizedUsername = username.trim().toLocaleLowerCase('en-US');
    const subjectKey = `owner:${normalizedUsername}`;
    await this.assertNotLocked('OWNER_PASSWORD', subjectKey, now);
    const identity = await this.repository.findOwnerByUsername(normalizedUsername);

    const dummySalt = 'AAAAAAAAAAAAAAAAAAAAAA';
    const valid = await verifyPasswordDigest({
      candidate: password,
      pepper: this.authPepper,
      salt: identity?.salt ?? dummySalt,
      iterations: identity?.work_factor ?? Number(this.env.AUTH_PBKDF2_ITERATIONS),
      expectedDigest: identity?.digest ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });

    if (!identity || !valid || identity.user_status !== 'ACTIVE') {
      await this.repository.recordFailure('OWNER_PASSWORD', subjectKey, now);
      throw new AppError('INVALID_CREDENTIALS', 'Thông tin đăng nhập không hợp lệ.', 401);
    }
    if (identity.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
    }
    await this.repository.clearFailures('OWNER_PASSWORD', subjectKey);
    return identity;
  }

  async ownerLogin(
    username: string,
    password: string,
  ): Promise<{ rawToken: string; response: LoginResponse }> {
    const identity = await this.verifyOwnerCredentials(username, password);
    const now = Date.now();
    const rawToken = randomOpaqueToken();
    const tokenHash = await hashOpaqueToken(rawToken, this.sessionTokenPepper);
    await this.repository.createSession({
      id: crypto.randomUUID(),
      tokenHash,
      userId: identity.user_id,
      storeId: identity.store_id,
      deviceId: null,
      kind: 'OWNER',
      credentialVersion: identity.credential_version,
      expiresAt: now + OWNER_ABSOLUTE_SECONDS * 1000,
      idleExpiresAt: now + OWNER_IDLE_SECONDS * 1000,
      now,
    });
    return {
      rawToken,
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

  async authorizeActivation(username: string, password: string) {
    const identity = await this.verifyOwnerCredentials(username, password);
    const now = Date.now();
    const rawGrant = randomOpaqueToken();
    await this.repository.createActivationGrant({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(rawGrant, this.authPepper),
      storeId: identity.store_id,
      ownerUserId: identity.user_id,
      expiresAt: now + ACTIVATION_SECONDS * 1000,
      now,
    });
    return {
      rawGrant,
      response: {
        expiresInSeconds: ACTIVATION_SECONDS,
        csrfToken: await deriveCsrfToken(rawGrant, this.authPepper),
      },
    };
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

  async reissueDevice(input: { deviceId: string; username: string; password: string }) {
    const owner = await this.verifyOwnerCredentials(input.username, input.password);
    const device = await this.repository.findDeviceById(owner.store_id, input.deviceId);
    if (!device) throw new AppError('DEVICE_NOT_FOUND', 'Không tìm thấy thiết bị.', 404);
    const rawDeviceSecret = randomOpaqueToken();
    const now = Date.now();
    await this.repository.reissueDeviceCredential({
      storeId: owner.store_id,
      deviceId: device.id,
      secretHash: await hashOpaqueToken(rawDeviceSecret, this.deviceTokenPepper),
      now,
      expiresAt: now + DEVICE_SECONDS * 1000,
    });
    return {
      rawDeviceSecret,
      device: {
        id: device.id,
        name: device.name,
        status: 'ACTIVE' as const,
        storeId: owner.store_id,
      },
    };
  }

  async changeOwnerPassword(input: {
    userId: string;
    storeId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    const identity = await this.repository.findOwnerCredentialById(input.userId, input.storeId);
    if (!identity) throw new AppError('AUTH_REQUIRED', 'Phiên đăng nhập không hợp lệ.', 401);
    const valid = await verifyPasswordDigest({
      candidate: input.currentPassword,
      pepper: this.authPepper,
      salt: identity.salt,
      iterations: identity.work_factor,
      expectedDigest: identity.digest,
    });
    if (!valid) {
      throw new AppError('INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng.', 401);
    }
    const salt = randomSalt();
    const workFactor = Number(this.env.AUTH_PBKDF2_ITERATIONS);
    await this.repository.updatePasswordCredential({
      userId: input.userId,
      salt,
      digest: await derivePasswordDigest({
        secret: input.newPassword,
        pepper: this.authPepper,
        salt,
        iterations: workFactor,
      }),
      workFactor,
      now: Date.now(),
    });
    return { changed: true };
  }

  async listDevices(storeId: string) {
    const result = await this.repository.listDevices(storeId);
    return result.results;
  }

  async revokeDevice(storeId: string, deviceId: string) {
    const result = await this.repository.revokeDevice(storeId, deviceId, Date.now());
    if ((result[0]?.meta.changes ?? 0) !== 1) {
      throw new AppError('DEVICE_NOT_FOUND', 'Không tìm thấy thiết bị đang hoạt động.', 404);
    }
    return { deviceId, status: 'REVOKED' as const };
  }

  async employeeLogin(input: {
    rawDeviceSecret: string;
    username: string;
    pin: string;
  }): Promise<{ rawToken: string; response: LoginResponse }> {
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
    const valid = await verifyPasswordDigest({
      candidate: input.pin,
      pepper: this.authPepper,
      salt: identity?.salt ?? 'AAAAAAAAAAAAAAAAAAAAAA',
      iterations: identity?.work_factor ?? Number(this.env.AUTH_PBKDF2_ITERATIONS),
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
    await this.repository.createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(rawToken, this.sessionTokenPepper),
      userId: identity.user_id,
      storeId: device.store_id,
      deviceId: device.device_id,
      kind: 'EMPLOYEE',
      credentialVersion: identity.credential_version,
      expiresAt: now + EMPLOYEE_ABSOLUTE_SECONDS * 1000,
      idleExpiresAt: now + EMPLOYEE_IDLE_SECONDS * 1000,
      now,
    });
    return {
      rawToken,
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

  async context(rawSession?: string, rawDevice?: string): Promise<AuthContextResponse> {
    const now = Date.now();
    const device = await this.resolveDevice(rawDevice);
    let actor: AuthContextResponse['actor'] = null;
    let csrfToken: string | null = null;

    if (rawSession) {
      const sessionHash = await hashOpaqueToken(rawSession, this.sessionTokenPepper);
      const session = await this.repository.findSessionByHash(sessionHash);
      const sessionValid =
        session?.session_status === 'ACTIVE' &&
        session.user_status === 'ACTIVE' &&
        session.expires_at > now &&
        session.idle_expires_at > now;
      const employeeDeviceValid =
        session?.session_kind !== 'EMPLOYEE' ||
        (device?.device_status === 'ACTIVE' &&
          session.session_device_id === device.device_id &&
          session.store_id === device.store_id);

      if (session && sessionValid && employeeDeviceValid) {
        actor = {
          id: session.user_id,
          displayName: session.display_name,
          kind: session.session_kind,
          storeId: session.store_id,
        };
        csrfToken = await deriveCsrfToken(rawSession, this.authPepper);
        if (now - session.last_seen_at > 5 * 60_000) {
          const idleSeconds =
            session.session_kind === 'EMPLOYEE' ? EMPLOYEE_IDLE_SECONDS : OWNER_IDLE_SECONDS;
          await this.repository.touchSession(session.session_id, now, now + idleSeconds * 1000);
        }
      }
    }

    const allowedEntrypoints: AuthContextResponse['allowedEntrypoints'] = [];
    if (actor?.kind === 'OWNER') allowedEntrypoints.push('OWNER');
    if (actor?.kind === 'SUPER_ADMIN') allowedEntrypoints.push('PLATFORM');
    if (device?.device_status === 'ACTIVE') allowedEntrypoints.push('EMPLOYEE');

    return {
      actor,
      device: device
        ? {
            id: device.device_id,
            name: device.device_name,
            status: device.device_status,
            storeId: device.store_id,
          }
        : null,
      allowedEntrypoints,
      csrfToken,
    };
  }

  async logout(rawSession: string) {
    const tokenHash = await hashOpaqueToken(rawSession, this.sessionTokenPepper);
    await this.repository.revokeSessionByHash(tokenHash, Date.now());
  }
}
