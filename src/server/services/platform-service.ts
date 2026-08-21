import { AppError } from '@server/lib/app-error';
import { safeEqualSecret } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { PlatformRepository } from '@server/repositories/platform-repository';

export class PlatformService {
  private readonly repository: PlatformRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PlatformRepository(env.DB);
  }

  async bootstrap(input: { bootstrapSecret: string; email: string; displayName: string }) {
    const expected = requireSecret(this.env.SYSTEM_BOOTSTRAP_SECRET, 'SYSTEM_BOOTSTRAP_SECRET');
    if (!safeEqualSecret(input.bootstrapSecret, expected)) {
      throw new AppError('BOOTSTRAP_FORBIDDEN', 'Không được phép.', 403);
    }
    if (await this.repository.hasSuperAdmin()) {
      throw new AppError('BOOTSTRAP_ALREADY_COMPLETED', 'Hệ thống đã được khởi tạo.', 409);
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.repository.createSuperAdmin({
      id,
      email: input.email.trim().toLocaleLowerCase('en-US'),
      displayName: input.displayName.trim(),
      now,
    });
    return { id };
  }

  async createStore(input: { name: string; ownerDisplayName: string; ownerEmail: string }) {
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
      ownerEmail: input.ownerEmail.trim().toLocaleLowerCase('en-US'),
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
    capability: 'POS_REALTIME';
    enabled: boolean;
    actorId: string;
    requestId: string;
  }) {
    const result = await this.repository.setStoreCapability({ ...input, now: Date.now() });
    if (!result) throw new AppError('STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.', 404);
    return { storeId: input.storeId, capability: input.capability, enabled: result.enabled === 1 };
  }
}
