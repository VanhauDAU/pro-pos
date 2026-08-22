import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { PlatformService } from '@server/services/platform-service';
import { CustomerService } from '@server/services/customer-service';

describe('Customer management', () => {
  let storeId: string;
  let ownerUserId: string;
  let service: CustomerService;

  beforeAll(async () => {
    const store = await new PlatformService(env).createStore({
      name: 'Customer Store',
      ownerDisplayName: 'Customer Owner',
      ownerEmail: 'customer.owner@example.com',
    });
    storeId = store.storeId;
    ownerUserId = store.ownerUserId;
    service = new CustomerService(env);
  });

  it('creates, searches and rejects duplicate phone numbers per store', async () => {
    const customer = await service.create(storeId, ownerUserId, {
      name: 'Nguyễn Khách Hàng',
      phone: '0901234567',
      gender: 'FEMALE',
      provinceCode: 1,
      provinceName: 'Hà Nội',
      note: null,
    });
    expect(customer).toMatchObject({
      name: 'Nguyễn Khách Hàng',
      phone: '0901234567',
      invoiceCount: 0,
      debtBalanceVnd: 0,
    });
    const list = await service.list(storeId, {
      search: '090123',
      status: 'ACTIVE',
      page: 1,
      limit: 20,
    });
    expect(list.results.map((item) => item.id)).toContain(customer.id);
    await expect(
      service.create(storeId, ownerUserId, { name: 'Trùng', phone: '0901234567' }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_PHONE_DUPLICATE' });
  });

  it('supports manual and automatic groups with AND conditions', async () => {
    const customer = (await service.list(storeId, { status: 'ACTIVE', page: 1, limit: 20 }))
      .results[0]!;
    const manual = await service.saveGroup(storeId, ownerUserId, {
      name: 'Khách VIP thủ công',
      membershipType: 'MANUAL',
      customerIds: [customer.id],
      rules: [],
      note: null,
    });
    expect(manual.customerIds).toEqual([customer.id]);
    const automatic = await service.saveGroup(storeId, ownerUserId, {
      name: 'Khách nữ Hà Nội',
      membershipType: 'AUTOMATIC',
      customerIds: [],
      rules: [
        { field: 'GENDER', operator: 'EQUAL', value: 'FEMALE' },
        { field: 'PROVINCE', operator: 'EQUAL', value: 1 },
      ],
      note: null,
    });
    expect(automatic.customerIds).toContain(customer.id);
  });

  it('records debt adjustments and blocks archiving a customer with debt', async () => {
    const customer = (await service.list(storeId, { status: 'ACTIVE', page: 1, limit: 20 }))
      .results[0]!;
    const adjusted = await service.adjustDebt(storeId, customer.id, ownerUserId, {
      amountVnd: 100_000,
      reason: 'Dư nợ đầu kỳ',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(adjusted.debtBalanceVnd).toBe(100_000);
    await expect(service.archive(storeId, customer.id)).rejects.toMatchObject({
      code: 'CUSTOMER_HAS_DEBT',
    });
    const paid = await service.payDebt(storeId, customer.id, ownerUserId, {
      amountVnd: 40_000,
      method: 'CASH',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(paid.debtBalanceVnd).toBe(60_000);
  });

  it('defaults loyalty to 10,000 VND per point and allows configuration', async () => {
    expect(await service.loyaltySettings(storeId)).toEqual({ enabled: true, vndPerPoint: 10_000 });
    expect(await service.saveLoyaltySettings(storeId, ownerUserId, false, 20_000)).toEqual({
      enabled: false,
      vndPerPoint: 20_000,
    });
  });
});
