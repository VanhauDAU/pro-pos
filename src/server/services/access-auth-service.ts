import type { AccessAuthPurpose, AccessStartResponse } from '@contracts/auth';
import { AppError } from '@server/lib/app-error';
import { hashOpaqueToken, randomOpaqueToken } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { AccessAuthRepository } from '@server/repositories/access-auth-repository';
import { AuthRepository } from '@server/repositories/auth-repository';

const ACCESS_REQUEST_SECONDS = 10 * 60;
const ACTIVATION_SECONDS = 5 * 60;
const OWNER_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
const OWNER_IDLE_SECONDS = 24 * 60 * 60;
const PLATFORM_ABSOLUTE_SECONDS = 12 * 60 * 60;
const PLATFORM_IDLE_SECONDS = 60 * 60;
const DEVICE_SECONDS = 365 * 24 * 60 * 60;

type AccessCompletion =
  | { purpose: 'OWNER_LOGIN' | 'PLATFORM_LOGIN'; rawSession: string; redirectTo: string }
  | { purpose: 'DEVICE_ACTIVATION'; rawGrant: string; redirectTo: string }
  | { purpose: 'DEVICE_REISSUE'; rawDeviceSecret: string; redirectTo: string };

export class AccessAuthService {
  private readonly repository: AccessAuthRepository;
  private readonly authRepository: AuthRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new AccessAuthRepository(env.DB);
    this.authRepository = new AuthRepository(env.DB);
  }

  private get authPepper() {
    return requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER');
  }

  private get sessionPepper() {
    return requireSecret(this.env.SESSION_TOKEN_PEPPER, 'SESSION_TOKEN_PEPPER');
  }

  private get devicePepper() {
    return requireSecret(this.env.DEVICE_TOKEN_PEPPER, 'DEVICE_TOKEN_PEPPER');
  }

  async begin(input: {
    purpose: AccessAuthPurpose;
    targetDeviceId?: string;
  }): Promise<{ rawState: string; response: AccessStartResponse }> {
    if (input.purpose === 'DEVICE_REISSUE' && !input.targetDeviceId) {
      throw new AppError('DEVICE_ID_REQUIRED', 'Thiếu thiết bị cần cấp lại quyền.', 422);
    }
    if (input.purpose !== 'DEVICE_REISSUE' && input.targetDeviceId) {
      throw new AppError('INVALID_ACCESS_REQUEST', 'Yêu cầu đăng nhập không hợp lệ.', 422);
    }

    const now = Date.now();
    const rawState = randomOpaqueToken();
    await this.repository.createRequest({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(rawState, this.authPepper),
      purpose: input.purpose,
      targetDeviceId: input.targetDeviceId ?? null,
      expiresAt: now + ACCESS_REQUEST_SECONDS * 1000,
      now,
    });
    return {
      rawState,
      response: {
        loginUrl: '/api/v1/auth/access/complete',
        expiresInSeconds: ACCESS_REQUEST_SECONDS,
      },
    };
  }

  async complete(input: {
    rawState: string;
    email: string;
    subject?: string;
  }): Promise<AccessCompletion> {
    const now = Date.now();
    const request = await this.repository.findRequestByHash(
      await hashOpaqueToken(input.rawState, this.authPepper),
    );
    if (!request) {
      throw new AppError('ACCESS_REQUEST_REQUIRED', 'Yêu cầu đăng nhập không hợp lệ.', 401);
    }
    if (request.status !== 'PENDING') {
      throw new AppError('ACCESS_REQUEST_USED', 'Yêu cầu đăng nhập đã được sử dụng.', 409);
    }
    if (request.expires_at <= now) {
      await this.repository.expireRequest(request.id);
      throw new AppError('ACCESS_REQUEST_EXPIRED', 'Yêu cầu đăng nhập đã hết hạn.', 401);
    }

    const consumed = await this.repository.consumeRequest(request.id, now);
    if ((consumed.meta.changes ?? 0) !== 1) {
      throw new AppError('ACCESS_REQUEST_USED', 'Yêu cầu đăng nhập đã được sử dụng.', 409);
    }

    const email = input.email.trim().toLocaleLowerCase('en-US');
    const identity = await this.repository.findIdentityByEmail(email);
    if (!identity || identity.user_status !== 'ACTIVE') {
      throw new AppError('ACCESS_IDENTITY_DENIED', 'Email không được cấp quyền Pro POS.', 403);
    }
    if (identity.subject && input.subject && identity.subject !== input.subject) {
      throw new AppError('ACCESS_IDENTITY_DENIED', 'Email không được cấp quyền Pro POS.', 403);
    }
    if (!identity.subject && input.subject) {
      await this.repository.bindSubjectIfMissing(identity.user_id, input.subject, now);
    }

    if (request.purpose === 'PLATFORM_LOGIN') {
      if (identity.platform_role !== 'SUPER_ADMIN') {
        throw new AppError('ACCESS_IDENTITY_DENIED', 'Email không được cấp quyền Pro POS.', 403);
      }
      const rawSession = await this.createSession({
        requestId: request.id,
        userId: identity.user_id,
        storeId: null,
        kind: 'SUPER_ADMIN',
        credentialVersion: identity.credential_version,
        absoluteSeconds: PLATFORM_ABSOLUTE_SECONDS,
        idleSeconds: PLATFORM_IDLE_SECONDS,
        now,
      });
      return { purpose: request.purpose, rawSession, redirectTo: '/platform' };
    }

    if (
      identity.role_code !== 'OWNER' ||
      identity.membership_status !== 'ACTIVE' ||
      !identity.store_id
    ) {
      throw new AppError('ACCESS_IDENTITY_DENIED', 'Email không được cấp quyền Pro POS.', 403);
    }
    if (identity.store_status !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
    }

    if (request.purpose === 'OWNER_LOGIN') {
      const rawSession = await this.createSession({
        requestId: request.id,
        userId: identity.user_id,
        storeId: identity.store_id,
        kind: 'OWNER',
        credentialVersion: identity.credential_version,
        absoluteSeconds: OWNER_ABSOLUTE_SECONDS,
        idleSeconds: OWNER_IDLE_SECONDS,
        now,
      });
      return { purpose: request.purpose, rawSession, redirectTo: '/owner' };
    }

    if (request.purpose === 'DEVICE_ACTIVATION') {
      const rawGrant = randomOpaqueToken();
      await this.authRepository.createActivationGrant({
        id: request.id,
        tokenHash: await hashOpaqueToken(rawGrant, this.authPepper),
        storeId: identity.store_id,
        ownerUserId: identity.user_id,
        expiresAt: now + ACTIVATION_SECONDS * 1000,
        now,
      });
      return {
        purpose: request.purpose,
        rawGrant,
        redirectTo: '/device-activation?authorized=1',
      };
    }

    const deviceId = request.target_device_id;
    if (!deviceId) {
      throw new AppError('DEVICE_ID_REQUIRED', 'Thiếu thiết bị cần cấp lại quyền.', 422);
    }
    const device = await this.authRepository.findDeviceById(identity.store_id, deviceId);
    if (!device) throw new AppError('DEVICE_NOT_FOUND', 'Không tìm thấy thiết bị.', 404);
    const rawDeviceSecret = randomOpaqueToken();
    await this.authRepository.reissueDeviceCredential({
      storeId: identity.store_id,
      deviceId,
      secretHash: await hashOpaqueToken(rawDeviceSecret, this.devicePepper),
      now,
      expiresAt: now + DEVICE_SECONDS * 1000,
    });
    return {
      purpose: request.purpose,
      rawDeviceSecret,
      redirectTo: '/?tab=employee&deviceReissued=1',
    };
  }

  private async createSession(input: {
    requestId: string;
    userId: string;
    storeId: string | null;
    kind: 'SUPER_ADMIN' | 'OWNER';
    credentialVersion: number;
    absoluteSeconds: number;
    idleSeconds: number;
    now: number;
  }) {
    const rawSession = randomOpaqueToken();
    await this.authRepository.createSession({
      id: input.requestId,
      tokenHash: await hashOpaqueToken(rawSession, this.sessionPepper),
      userId: input.userId,
      storeId: input.storeId,
      deviceId: null,
      kind: input.kind,
      credentialVersion: input.credentialVersion,
      expiresAt: input.now + input.absoluteSeconds * 1000,
      idleExpiresAt: input.now + input.idleSeconds * 1000,
      now: input.now,
    });
    return rawSession;
  }
}
