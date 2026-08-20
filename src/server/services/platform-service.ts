import { AppError } from '@server/lib/app-error';
import {
  deriveCsrfToken,
  derivePasswordDigest,
  hashOpaqueToken,
  randomOpaqueToken,
  randomSalt,
  safeEqualSecret,
  verifyPasswordDigest,
} from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { AuthRepository } from '@server/repositories/auth-repository';
import { PlatformRepository } from '@server/repositories/platform-repository';

export class PlatformService {
  private readonly repository: PlatformRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PlatformRepository(env.DB);
  }

  private get workFactor() {
    const value = Number(this.env.AUTH_PBKDF2_ITERATIONS);
    if (!Number.isInteger(value) || value <= 0) {
      throw new AppError('SERVER_MISCONFIGURED', 'Invalid auth work factor.', 503);
    }
    return value;
  }

  private get authPepper() {
    return requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER');
  }

  async bootstrap(input: {
    bootstrapSecret: string;
    username: string;
    displayName: string;
    password: string;
  }) {
    const expected = requireSecret(this.env.SYSTEM_BOOTSTRAP_SECRET, 'SYSTEM_BOOTSTRAP_SECRET');
    if (!safeEqualSecret(input.bootstrapSecret, expected)) {
      throw new AppError('BOOTSTRAP_FORBIDDEN', 'Không được phép.', 403);
    }
    if (await this.repository.hasSuperAdmin()) {
      throw new AppError('BOOTSTRAP_ALREADY_COMPLETED', 'Hệ thống đã được khởi tạo.', 409);
    }
    const salt = randomSalt();
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.repository.createSuperAdmin({
      id,
      username: input.username.trim().toLocaleLowerCase('en-US'),
      displayName: input.displayName.trim(),
      workFactor: this.workFactor,
      salt,
      digest: await derivePasswordDigest({
        secret: input.password,
        pepper: this.authPepper,
        salt,
        iterations: this.workFactor,
      }),
      now,
    });
    return { id };
  }

  async login(username: string, password: string) {
    const identity = await this.repository.findSuperAdminByUsername(
      username.trim().toLocaleLowerCase('en-US'),
    );
    const valid = await verifyPasswordDigest({
      candidate: password,
      pepper: this.authPepper,
      salt: identity?.salt ?? 'AAAAAAAAAAAAAAAAAAAAAA',
      iterations: identity?.work_factor ?? this.workFactor,
      expectedDigest: identity?.digest ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    if (!identity || !valid || identity.user_status !== 'ACTIVE') {
      throw new AppError('INVALID_CREDENTIALS', 'Thông tin đăng nhập không hợp lệ.', 401);
    }
    const rawToken = randomOpaqueToken();
    const now = Date.now();
    await new AuthRepository(this.env.DB).createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(
        rawToken,
        requireSecret(this.env.SESSION_TOKEN_PEPPER, 'SESSION_TOKEN_PEPPER'),
      ),
      userId: identity.user_id,
      storeId: null,
      deviceId: null,
      kind: 'SUPER_ADMIN',
      credentialVersion: identity.credential_version,
      expiresAt: now + 12 * 60 * 60_000,
      idleExpiresAt: now + 60 * 60_000,
      now,
    });
    return {
      rawToken,
      actor: {
        id: identity.user_id,
        displayName: identity.display_name,
        kind: 'SUPER_ADMIN' as const,
        storeId: null,
      },
      csrfToken: await deriveCsrfToken(rawToken, this.authPepper),
    };
  }

  async createStore(input: {
    name: string;
    ownerDisplayName: string;
    ownerUsername: string;
    ownerPassword: string;
  }) {
    const salt = randomSalt();
    const now = Date.now();
    const storeId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    await this.repository.createStoreWithOwner({
      storeId,
      storeName: input.name.trim(),
      ownerRoleId: crypto.randomUUID(),
      employeeRoleId: crypto.randomUUID(),
      ownerUserId,
      ownerMembershipId: crypto.randomUUID(),
      ownerDisplayName: input.ownerDisplayName.trim(),
      ownerUsername: input.ownerUsername.trim().toLocaleLowerCase('en-US'),
      workFactor: this.workFactor,
      salt,
      digest: await derivePasswordDigest({
        secret: input.ownerPassword,
        pepper: this.authPepper,
        salt,
        iterations: this.workFactor,
      }),
      now,
    });
    return { storeId, ownerUserId };
  }

  listStores() {
    return this.repository.listStores();
  }

  async setStoreStatus(storeId: string, status: 'ACTIVE' | 'LOCKED') {
    const result = await this.repository.setStoreStatus(storeId, status, Date.now());
    if ((result.meta.changes ?? 0) !== 1) {
      throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    }
    return { storeId, status };
  }
}
