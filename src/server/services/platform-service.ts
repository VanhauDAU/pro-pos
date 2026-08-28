import { AppError } from '@server/lib/app-error';
import {
  DEFAULT_PASSWORD_WORK_FACTOR,
  derivePasswordDigest,
  randomSalt,
  safeEqualSecret,
} from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { PlatformRepository } from '@server/repositories/platform-repository';
import type { StoreCapability } from '@contracts/platform';

export class PlatformService {
  private readonly repository: PlatformRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PlatformRepository(env.DB);
  }

  async bootstrap(input: {
    bootstrapSecret: string;
    username?: string | undefined;
    email: string;
    displayName: string;
    password?: string | undefined;
  }) {
    const expected = requireSecret(this.env.SYSTEM_BOOTSTRAP_SECRET, 'SYSTEM_BOOTSTRAP_SECRET');
    if (!safeEqualSecret(input.bootstrapSecret, expected)) {
      throw new AppError('BOOTSTRAP_FORBIDDEN', 'Không được phép.', 403);
    }
    if (await this.repository.hasSuperAdmin()) {
      throw new AppError('BOOTSTRAP_ALREADY_COMPLETED', 'Hệ thống đã được khởi tạo.', 409);
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    let passwordData:
      { salt: string; digest: string; workFactor: number; pepperVersion: number } | undefined;
    if (input.password) {
      const salt = randomSalt(16);
      const pepper = requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER');
      const digest = await derivePasswordDigest({
        password: input.password,
        salt,
        pepper,
        workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
      });
      passwordData = {
        salt,
        digest,
        workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
        pepperVersion: 1,
      };
    }
    await this.repository.createSuperAdmin({
      id,
      username: input.username?.trim(),
      email: input.email.trim().toLocaleLowerCase('en-US'),
      displayName: input.displayName.trim(),
      password: passwordData,
      now,
    });
    return { id };
  }

  async createStore(input: {
    name: string;
    ownerDisplayName: string;
    ownerEmail: string;
    ownerUsername?: string | undefined;
    ownerPassword?: string | undefined;
  }) {
    const now = Date.now();
    const storeId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    let ownerPasswordData:
      { salt: string; digest: string; workFactor: number; pepperVersion: number } | undefined;
    if (input.ownerPassword) {
      const salt = randomSalt(16);
      const pepper = requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER');
      const digest = await derivePasswordDigest({
        password: input.ownerPassword,
        salt,
        pepper,
        workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
      });
      ownerPasswordData = {
        salt,
        digest,
        workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
        pepperVersion: 1,
      };
    }
    await this.repository.createStoreWithOwner({
      storeId,
      storeName: input.name.trim(),
      ownerRoleId: crypto.randomUUID(),
      employeeRoleId: crypto.randomUUID(),
      ownerUserId,
      ownerMembershipId: crypto.randomUUID(),
      ownerDisplayName: input.ownerDisplayName.trim(),
      ownerEmail: input.ownerEmail.trim().toLocaleLowerCase('en-US'),
      ownerUsername: input.ownerUsername?.trim(),
      ownerPassword: ownerPasswordData,
      now,
    });
    return { storeId, ownerUserId };
  }

  async listStores() {
    const result = await this.repository.listStores();
    return {
      ...result,
      results: result.results.map((store) =>
        Object.assign(store, { posRealtimeEnabled: Boolean(store.posRealtimeEnabled) }),
      ),
    };
  }

  async setStoreStatus(storeId: string, status: 'ACTIVE' | 'LOCKED') {
    const result = await this.repository.setStoreStatus(storeId, status, Date.now());
    if ((result.meta.changes ?? 0) !== 1) {
      throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    }
    return { storeId, status };
  }

  async setStoreCapability(input: {
    storeId: string;
    capability: StoreCapability;
    enabled: boolean;
    actorId: string;
    requestId: string;
  }) {
    const result = await this.repository.setStoreCapability({ ...input, now: Date.now() });
    if (!result) throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    return { storeId: input.storeId, capability: input.capability, enabled: result.enabled === 1 };
  }

  async getStoreDetails(storeId: string) {
    const details = await this.repository.getStoreDetails(storeId);
    if (!details) {
      throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    }
    return details;
  }

  async updateStoreMember(input: {
    storeId: string;
    userId: string;
    displayName?: string | undefined;
    username?: string | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    status?: 'ACTIVE' | 'DISABLED' | undefined;
    newPassword?: string | undefined;
  }) {
    let passwordData:
      { salt: string; digest: string; workFactor: number; pepperVersion: number } | undefined;
    if (input.newPassword) {
      const salt = randomSalt(16);
      const pepper = requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER');
      const digest = await derivePasswordDigest({
        password: input.newPassword,
        salt,
        pepper,
        workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
      });
      passwordData = {
        salt,
        digest,
        workFactor: DEFAULT_PASSWORD_WORK_FACTOR,
        pepperVersion: 1,
      };
    }

    const result = await this.repository.updateStoreMember({
      storeId: input.storeId,
      userId: input.userId,
      displayName: input.displayName,
      username: input.username,
      email: input.email,
      phone: input.phone,
      status: input.status,
      password: passwordData,
      now: Date.now(),
    });

    if (!result) {
      throw new AppError(
        'MEMBER_NOT_FOUND',
        'Không tìm thấy tài khoản thành viên trong cửa hàng.',
        404,
      );
    }
    return { success: true };
  }

  async getPlatformAnalytics(days?: number) {
    return this.repository.getPlatformAnalytics(days);
  }

  async revokeSession(input: { storeId: string; sessionId: string }) {
    await this.repository.revokeSession(input.storeId, input.sessionId, Date.now());
    return { success: true };
  }

  async revokeDevice(input: { storeId: string; deviceId: string }) {
    await this.repository.revokeDevice(input.storeId, input.deviceId, Date.now());
    return { success: true };
  }

  async deleteStore(storeId: string) {
    let result: Awaited<ReturnType<PlatformRepository['deleteStore']>>;
    try {
      result = await this.repository.deleteStore(storeId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new AppError(
        'STORE_DELETE_FAILED',
        'Không thể xóa hết dữ liệu cửa hàng. Hãy thử lại; hệ thống sẽ tiếp tục dọn các phần còn lại.',
        500,
        { reason },
      );
    }
    if (!result) {
      throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    }
    if (this.env.MEDIA && result.mediaKeys.length > 0) {
      // R2 accepts bulk deletes. Bound each request so a store with many
      // product/receipt assets cannot create thousands of concurrent deletes.
      const R2_DELETE_CHUNK_SIZE = 1_000;
      for (let index = 0; index < result.mediaKeys.length; index += R2_DELETE_CHUNK_SIZE) {
        const keys = result.mediaKeys.slice(index, index + R2_DELETE_CHUNK_SIZE);
        try {
          await this.env.MEDIA.delete(keys);
        } catch {
          // D1 is already purged. A retry of this action cannot recreate media
          // metadata, so leave orphaned objects for lifecycle cleanup instead
          // of falsely reporting that the store deletion failed.
        }
      }
    }
    return { success: true, storeId };
  }
}
