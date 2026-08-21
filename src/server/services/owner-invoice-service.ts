import { OwnerInvoiceRepository } from '@server/repositories/owner-invoice-repository';
import type { AppEnv } from '@server/types';

interface ListInvoicesInput {
  storeId: string;
  status: 'PAID' | 'CANCELLED' | undefined;
  search: string;
  orderType: 'DINE_IN' | 'TAKEAWAY' | undefined;
  method: 'CASH' | 'BANK_TRANSFER' | undefined;
  dateFrom: string | null;
  dateTo: string | null;
  page: number;
  limit: number;
}

export class OwnerInvoiceService {
  private repository: OwnerInvoiceRepository;

  constructor(env: AppEnv['Bindings']) {
    this.repository = new OwnerInvoiceRepository(env.DB);
  }

  async listInvoices(input: ListInvoicesInput) {
    const { results, total } = await this.repository.listInvoices(input);
    return {
      results,
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    };
  }
}
