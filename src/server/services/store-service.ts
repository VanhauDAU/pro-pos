import { StoreRepository } from '@server/repositories/store-repository';

export class StoreService {
  private readonly repository: StoreRepository;

  constructor(env: CloudflareBindings) {
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
  }) {
    await this.repository.updateSettings({ ...input, now: Date.now() });
    return { storeId: input.storeId, updated: true };
  }

  async listAuditLogs(storeId: string) {
    const result = await this.repository.listAuditLogs(storeId, 100);
    return result.results;
  }
}
