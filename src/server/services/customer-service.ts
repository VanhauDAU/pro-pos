import type { CustomerGroupRule, CustomerInput } from '@contracts/customer';
import { AppError } from '@server/lib/app-error';
import { CustomerRepository } from '@server/repositories/customer-repository';

export function normalizeCustomerPhone(phone: string) {
  return phone.replace(/[\s.()-]/g, '');
}

export class CustomerService {
  private readonly repository: CustomerRepository;
  constructor(private readonly env: CloudflareBindings) {
    this.repository = new CustomerRepository(env.DB);
  }

  private decorate<T extends { invoiceCount: number; totalSpentVnd: number }>(row: T) {
    return {
      ...row,
      averageSpentVnd: row.invoiceCount ? Math.round(row.totalSpentVnd / row.invoiceCount) : 0,
    };
  }

  private async groupsForCustomer(
    storeId: string,
    customer: NonNullable<Awaited<ReturnType<CustomerRepository['findById']>>>,
  ) {
    const manual = (await this.repository.groupsForCustomer(storeId, customer.id)).results;
    const groups = await this.repository.listGroups(storeId);
    const automatic = groups.results
      .filter((group) => {
        if (group.membershipType !== 'AUTOMATIC') return false;
        const rules = group.rulesJson ? (JSON.parse(group.rulesJson) as CustomerGroupRule[]) : [];
        return rules.length > 0 && rules.every((rule) => this.matchesRule(customer, rule));
      })
      .map((group) => ({ id: group.id, name: group.name }));
    return [...manual, ...automatic];
  }

  async list(
    storeId: string,
    input: { search?: string; status?: string; page: number; limit: number },
  ) {
    const result = await this.repository.list(storeId, {
      ...(input.search ? { search: input.search } : {}),
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit,
      offset: (input.page - 1) * input.limit,
    });
    return {
      ...result,
      page: input.page,
      limit: input.limit,
      results: await Promise.all(
        result.results.map(async (row) => ({
          ...this.decorate(row),
          groups: await this.groupsForCustomer(storeId, row),
        })),
      ),
    };
  }

  async detail(storeId: string, id: string) {
    const row = await this.repository.findById(storeId, id);
    if (!row) throw new AppError('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    const [groups, invoices, loyalty, debt] = await Promise.all([
      this.groupsForCustomer(storeId, row),
      this.repository.invoices(storeId, id),
      this.repository.loyaltyEntries(storeId, id),
      this.repository.debtEntries(storeId, id),
    ]);
    return {
      ...this.decorate(row),
      groups,
      invoices: invoices.results,
      loyaltyEntries: loyalty.results,
      debtEntries: debt.results,
    };
  }

  async create(storeId: string, actorId: string, data: CustomerInput) {
    const phone = normalizeCustomerPhone(data.phone);
    if (await this.repository.findByPhone(storeId, phone)) {
      throw new AppError(
        'CUSTOMER_PHONE_DUPLICATE',
        'Số điện thoại đã thuộc một khách hàng khác.',
        409,
      );
    }
    const id = crypto.randomUUID();
    await this.repository.create({
      id,
      storeId,
      actorId,
      normalizedPhone: phone,
      data,
      now: Date.now(),
    });
    return this.detail(storeId, id);
  }

  async validateImport(storeId: string, rows: CustomerInput[]) {
    const errors: Array<{ row: number; message: string }> = [];
    const seen = new Set<string>();
    const existingChecks = await Promise.all(
      rows.map((row) => this.repository.findByPhone(storeId, normalizeCustomerPhone(row.phone))),
    );

    for (const [index, row] of rows.entries()) {
      const phone = normalizeCustomerPhone(row.phone);
      if (seen.has(phone)) {
        errors.push({ row: index + 2, message: 'Số điện thoại bị trùng trong file.' });
      } else if (existingChecks[index]) {
        errors.push({ row: index + 2, message: 'Số điện thoại đã tồn tại.' });
      }
      seen.add(phone);
    }
    return { valid: errors.length === 0, total: rows.length, errors };
  }

  async import(storeId: string, actorId: string, rows: CustomerInput[]) {
    const validation = await this.validateImport(storeId, rows);
    if (!validation.valid)
      throw new AppError(
        'CUSTOMER_IMPORT_INVALID',
        'File nhập có dữ liệu không hợp lệ.',
        422,
        validation,
      );
    for (const row of rows) {
      await this.create(storeId, actorId, row);
    }
    return { imported: rows.length };
  }

  async update(storeId: string, id: string, data: CustomerInput) {
    const existing = await this.repository.findById(storeId, id);
    if (!existing) throw new AppError('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    const phone = normalizeCustomerPhone(data.phone);
    const duplicate = await this.repository.findByPhone(storeId, phone);
    if (duplicate && duplicate.id !== id)
      throw new AppError('CUSTOMER_PHONE_DUPLICATE', 'Số điện thoại đã tồn tại.', 409);
    await this.repository.update({ id, storeId, normalizedPhone: phone, data, now: Date.now() });
    return this.detail(storeId, id);
  }

  async archive(storeId: string, id: string) {
    const customer = await this.repository.findById(storeId, id);
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    if (customer.debtBalanceVnd > 0)
      throw new AppError(
        'CUSTOMER_HAS_DEBT',
        'Không thể lưu trữ khách hàng đang còn công nợ.',
        409,
      );
    await this.repository.archive(storeId, id, Date.now());
    return { id, archived: true };
  }

  private matchesRule(
    customer: Awaited<ReturnType<CustomerRepository['findById']>> & {},
    rule: CustomerGroupRule,
  ) {
    const numeric = (actual: number) =>
      rule.operator === 'EQUAL'
        ? actual === Number(rule.value)
        : rule.operator === 'LESS_THAN'
          ? actual < Number(rule.value)
          : rule.operator === 'GREATER_THAN'
            ? actual > Number(rule.value)
            : actual >= Number(rule.value) && actual <= Number(rule.valueTo);
    switch (rule.field) {
      case 'BIRTH_MONTH':
        return numeric(Number(customer.birthDate?.slice(5, 7) ?? 0));
      case 'PROVINCE':
        return customer.provinceCode === Number(rule.value);
      case 'WARD':
        return customer.wardCode === Number(rule.value);
      case 'INVOICE_COUNT':
        return numeric(customer.invoiceCount);
      case 'TOTAL_SPENT':
        return numeric(customer.totalSpentVnd);
      case 'GENDER':
        return customer.gender === rule.value;
    }
  }

  async listGroups(storeId: string) {
    const groups = await this.repository.listGroups(storeId);
    const active = await this.repository.list(storeId, {
      status: 'ACTIVE',
      limit: 10000,
      offset: 0,
    });
    return groups.results.map((group) => {
      const rules = group.rulesJson ? (JSON.parse(group.rulesJson) as CustomerGroupRule[]) : [];
      const count =
        group.membershipType === 'AUTOMATIC'
          ? active.results.filter((customer) =>
              rules.every((rule) => this.matchesRule(customer, rule)),
            ).length
          : group.manualCount;
      return { ...group, rules, customerCount: count, customerIds: [] };
    });
  }

  async groupDetail(storeId: string, id: string) {
    const group = await this.repository.findGroup(storeId, id);
    if (!group)
      throw new AppError('CUSTOMER_GROUP_NOT_FOUND', 'Không tìm thấy nhóm khách hàng.', 404);
    const rules = group.rulesJson ? (JSON.parse(group.rulesJson) as CustomerGroupRule[]) : [];
    let customerIds = group.customerIds;
    if (group.membershipType === 'AUTOMATIC') {
      const active = await this.repository.list(storeId, {
        status: 'ACTIVE',
        limit: 10000,
        offset: 0,
      });
      customerIds = active.results
        .filter((customer) => rules.every((rule) => this.matchesRule(customer, rule)))
        .map((customer) => customer.id);
    }
    return { ...group, rules, customerIds, customerCount: customerIds.length };
  }

  async saveGroup(
    storeId: string,
    actorId: string,
    data: Parameters<CustomerRepository['saveGroup']>[0]['data'],
    id?: string,
  ) {
    const groupId = id ?? crypto.randomUUID();
    if (id && !(await this.repository.findGroup(storeId, id)))
      throw new AppError('CUSTOMER_GROUP_NOT_FOUND', 'Không tìm thấy nhóm khách hàng.', 404);
    try {
      await this.repository.saveGroup({
        id: groupId,
        storeId,
        actorId,
        data,
        now: Date.now(),
        existing: Boolean(id),
      });
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        throw new AppError('CUSTOMER_GROUP_DUPLICATE', 'Tên nhóm khách hàng đã tồn tại.', 409);
      throw error;
    }
    return this.groupDetail(storeId, groupId);
  }

  async deleteGroup(storeId: string, id: string) {
    await this.repository.deleteGroup(storeId, id);
    return { id, deleted: true };
  }

  async loyaltySettings(storeId: string) {
    const row = await this.repository.getLoyaltySettings(storeId);
    return row
      ? { enabled: Boolean(row.enabled), vndPerPoint: row.vndPerPoint }
      : { enabled: true, vndPerPoint: 10000 };
  }

  async saveLoyaltySettings(
    storeId: string,
    actorId: string,
    enabled: boolean,
    vndPerPoint: number,
  ) {
    await this.repository.saveLoyaltySettings(storeId, actorId, enabled, vndPerPoint, Date.now());
    return { enabled, vndPerPoint };
  }

  async payDebt(
    storeId: string,
    customerId: string,
    actorId: string,
    input: {
      amountVnd: number;
      method: 'CASH' | 'BANK_TRANSFER';
      note?: string | null | undefined;
      idempotencyKey: string;
    },
  ) {
    const customer = await this.repository.findById(storeId, customerId);
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    if (input.amountVnd > customer.debtBalanceVnd)
      throw new AppError('DEBT_PAYMENT_TOO_HIGH', 'Số tiền thu vượt quá công nợ.', 422);
    const debtPaymentId = crypto.randomUUID();
    await this.repository.addDebtEntry({
      id: debtPaymentId,
      storeId,
      customerId,
      actorId,
      type: 'PAYMENT',
      amountVnd: -input.amountVnd,
      method: input.method,
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
      now: Date.now(),
    });
    return { ...(await this.detail(storeId, customerId)), debtPaymentId };
  }

  async getDebtPayment(storeId: string, documentId: string) {
    const payment = await this.repository.findDebtPayment(storeId, documentId);
    if (!payment) {
      throw new AppError('DEBT_PAYMENT_NOT_FOUND', 'Không tìm thấy phiếu thu công nợ.', 404);
    }
    const amountVnd = Math.abs(payment.signedAmountVnd);
    return {
      ...payment,
      amountVnd,
      debtBeforeVnd: payment.debtAfterVnd + amountVnd,
      customerAddress: [
        payment.customerAddress,
        payment.customerWardName,
        payment.customerProvinceName,
      ]
        .filter(Boolean)
        .join(', '),
    };
  }

  async adjustDebt(
    storeId: string,
    customerId: string,
    actorId: string,
    input: { amountVnd: number; reason: string; idempotencyKey: string },
  ) {
    const customer = await this.repository.findById(storeId, customerId);
    if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    if (customer.debtBalanceVnd + input.amountVnd < 0)
      throw new AppError('DEBT_ADJUSTMENT_INVALID', 'Điều chỉnh làm công nợ âm.', 422);
    await this.repository.addDebtEntry({
      id: crypto.randomUUID(),
      storeId,
      customerId,
      actorId,
      type: 'ADJUSTMENT',
      amountVnd: input.amountVnd,
      note: input.reason,
      idempotencyKey: input.idempotencyKey,
      now: Date.now(),
    });
    return this.detail(storeId, customerId);
  }
}
