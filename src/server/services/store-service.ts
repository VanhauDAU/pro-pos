import { AppError } from '@server/lib/app-error';
import { StoreRepository } from '@server/repositories/store-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

export class StoreService {
  private readonly repository: StoreRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new StoreRepository(env.DB);
  }

  getSettings(storeId: string) {
    return this.repository.getSettings(storeId);
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
    auditContext?: AuditContext;
  }) {
    if (
      input.bankQrMediaId &&
      !(await this.repository.findActiveBankQrMedia(input.storeId, input.bankQrMediaId))
    ) {
      throw new AppError('BANK_QR_MEDIA_NOT_FOUND', 'Không tìm thấy ảnh QR ngân hàng.', 404);
    }
    const before = input.auditContext ? await this.repository.getSettings(input.storeId) : null;
    const now = Date.now();
    await this.repository.updateSettings({ ...input, now });
    if (input.auditContext) {
      const after = await this.repository.getSettings(input.storeId);
      await new AuditRepository(this.env.DB).record({
        storeId: input.storeId,
        context: input.auditContext,
        action: 'STORE_SETTINGS_UPDATED',
        entityType: 'STORE',
        entityId: input.storeId,
        before,
        after,
        now,
      });
    }
    return { storeId: input.storeId, updated: true };
  }

  async listAuditLogs(storeId: string) {
    const result = await this.repository.listAuditLogs(storeId, 100);
    return result.results;
  }
}
