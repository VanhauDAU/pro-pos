import { describe, expect, it } from 'vitest';

import {
  customerGroupInputSchema,
  customerInputSchema,
  debtAdjustmentSchema,
  debtPaymentSchema,
} from '@contracts/customer';
import { rolePermissionCatalog, rolePermissionKeys } from '@contracts/staff';
import { getPosCustomerAccess } from '@client/features/pos/pos-customer-access';

const checkCustomerAccess = (userPermissions: string[], isOwner: boolean) => {
  const perms = userPermissions;
  return {
    canViewList: isOwner || perms.includes('customer.list.view'),
    canCreateCustomer: isOwner || perms.includes('customer.list.create'),
    canEditCustomer: isOwner || perms.includes('customer.list.edit_debt'),
    canDeleteCustomer: isOwner || perms.includes('customer.list.delete'),
    canCollectOrAdjustDebt: isOwner || perms.includes('customer.list.edit_debt'),
    canImportExport: isOwner || perms.includes('customer.list.import_export'),
    canViewGroups: isOwner || perms.includes('customer.groups.view'),
    canCreateGroup: isOwner || perms.includes('customer.groups.create'),
    canEditGroup: isOwner || perms.includes('customer.groups.edit'),
    canDeleteGroup: isOwner || perms.includes('customer.groups.delete'),
  };
};

describe('POS Customer RBAC Permission Matrix & Schemas', () => {
  it('shows inline customer creation only when the corresponding permission is granted', () => {
    expect(getPosCustomerAccess(['order.add_customer'], false)).toEqual({
      canAttachCustomer: true,
      canCreateCustomer: false,
    });
    expect(getPosCustomerAccess(['order.add_customer', 'customer.list.create'], false)).toEqual({
      canAttachCustomer: true,
      canCreateCustomer: true,
    });
    expect(getPosCustomerAccess([], true)).toEqual({
      canAttachCustomer: true,
      canCreateCustomer: true,
    });
  });

  it('contains all 9 required customer permissions in rolePermissionCatalog', () => {
    const customerGroup = rolePermissionCatalog
      .find((group) => group.key === 'management')
      ?.sections.find((section) => section.key === 'customers');

    expect(customerGroup).toBeDefined();
    const permissions = customerGroup!.permissions.map(([key]) => key);

    expect(permissions).toContain('customer.list.view');
    expect(permissions).toContain('customer.list.edit_debt');
    expect(permissions).toContain('customer.list.import_export');
    expect(permissions).toContain('customer.list.create');
    expect(permissions).toContain('customer.list.delete');
    expect(permissions).toContain('customer.groups.view');
    expect(permissions).toContain('customer.groups.edit');
    expect(permissions).toContain('customer.groups.create');
    expect(permissions).toContain('customer.groups.delete');

    // Also check sales permission for picking customer on order
    expect(rolePermissionKeys).toContain('order.add_customer');
  });

  it('correctly evaluates staff permissions for customer actions', () => {
    // 1. Owner has full permissions unconditionally
    const ownerAccess = checkCustomerAccess([], true);
    expect(ownerAccess.canViewList).toBe(true);
    expect(ownerAccess.canCreateCustomer).toBe(true);
    expect(ownerAccess.canEditCustomer).toBe(true);
    expect(ownerAccess.canDeleteCustomer).toBe(true);
    expect(ownerAccess.canCollectOrAdjustDebt).toBe(true);
    expect(ownerAccess.canImportExport).toBe(true);
    expect(ownerAccess.canViewGroups).toBe(true);
    expect(ownerAccess.canCreateGroup).toBe(true);
    expect(ownerAccess.canEditGroup).toBe(true);
    expect(ownerAccess.canDeleteGroup).toBe(true);

    // 2. Staff with only cashier order picking permission (order.add_customer) cannot access customer management module
    const cashierAccess = checkCustomerAccess(['order.add_customer'], false);
    expect(cashierAccess.canViewList).toBe(false);
    expect(cashierAccess.canCreateCustomer).toBe(false);
    expect(cashierAccess.canDeleteCustomer).toBe(false);
    expect(cashierAccess.canCollectOrAdjustDebt).toBe(false);
    expect(cashierAccess.canImportExport).toBe(false);
    expect(cashierAccess.canViewGroups).toBe(false);

    // 3. Staff with view & debt management permissions
    const accountantAccess = checkCustomerAccess(
      ['customer.list.view', 'customer.list.edit_debt', 'customer.list.import_export'],
      false,
    );
    expect(accountantAccess.canViewList).toBe(true);
    expect(accountantAccess.canEditCustomer).toBe(true);
    expect(accountantAccess.canCollectOrAdjustDebt).toBe(true);
    expect(accountantAccess.canImportExport).toBe(true);
    expect(accountantAccess.canDeleteCustomer).toBe(false); // cannot delete
    expect(accountantAccess.canCreateGroup).toBe(false); // cannot create groups

    // 4. Staff with customer group manager permissions
    const marketingAccess = checkCustomerAccess(
      [
        'customer.list.view',
        'customer.groups.view',
        'customer.groups.create',
        'customer.groups.edit',
      ],
      false,
    );
    expect(marketingAccess.canViewList).toBe(true);
    expect(marketingAccess.canViewGroups).toBe(true);
    expect(marketingAccess.canCreateGroup).toBe(true);
    expect(marketingAccess.canEditGroup).toBe(true);
    expect(marketingAccess.canDeleteGroup).toBe(false); // cannot delete groups
    expect(marketingAccess.canCollectOrAdjustDebt).toBe(false); // cannot adjust debt
  });

  it('validates debt payment schema correctly', () => {
    const validPayment = {
      amountVnd: 50000,
      method: 'CASH' as const,
      note: 'Thu nợ bàn 2',
      idempotencyKey: 'idem-key-12345',
    };
    expect(debtPaymentSchema.safeParse(validPayment).success).toBe(true);

    // Invalid negative amount
    expect(
      debtPaymentSchema.safeParse({
        ...validPayment,
        amountVnd: -1000,
      }).success,
    ).toBe(false);

    // Invalid 0 amount
    expect(
      debtPaymentSchema.safeParse({
        ...validPayment,
        amountVnd: 0,
      }).success,
    ).toBe(false);
  });

  it('validates debt adjustment schema correctly for positive and negative values', () => {
    // Positive adjustment (increasing debt)
    expect(
      debtAdjustmentSchema.safeParse({
        amountVnd: 100000,
        reason: 'Tính bù phụ thu dịch vụ',
        idempotencyKey: 'adj-key-12345',
      }).success,
    ).toBe(true);

    // Negative adjustment (decreasing debt / discount waiver)
    expect(
      debtAdjustmentSchema.safeParse({
        amountVnd: -50000,
        reason: 'Giảm trừ khuyến mại sinh nhật',
        idempotencyKey: 'adj-key-12346',
      }).success,
    ).toBe(true);

    // Zero adjustment is invalid
    expect(
      debtAdjustmentSchema.safeParse({
        amountVnd: 0,
        reason: 'Không thay đổi',
        idempotencyKey: 'adj-key-12347',
      }).success,
    ).toBe(false);

    // Missing reason is invalid
    expect(
      debtAdjustmentSchema.safeParse({
        amountVnd: 50000,
        reason: '',
        idempotencyKey: 'adj-key-12348',
      }).success,
    ).toBe(false);
  });

  it('validates customer group rules in automatic membership type', () => {
    // Valid automatic group with rules
    const validAutoGroup = {
      name: 'Khách VIP Chi tiêu cao',
      membershipType: 'AUTOMATIC' as const,
      customerIds: [],
      rules: [
        {
          field: 'TOTAL_SPENT' as const,
          operator: 'GREATER_THAN' as const,
          value: 10000000,
        },
      ],
      note: 'Tự động gán cho khách có tổng chi tiêu trên 10 triệu',
    };
    expect(customerGroupInputSchema.safeParse(validAutoGroup).success).toBe(true);

    // Invalid automatic group without rules
    const invalidAutoGroup = {
      name: 'Khách VIP',
      membershipType: 'AUTOMATIC' as const,
      customerIds: [],
      rules: [],
    };
    expect(customerGroupInputSchema.safeParse(invalidAutoGroup).success).toBe(false);

    // Valid manual group with customer ids
    const validManualGroup = {
      name: 'Khách VIP Thủ công',
      membershipType: 'MANUAL' as const,
      customerIds: ['c3c9b740-4277-4b7c-87d9-9599d14fbf8e'],
      rules: [],
    };
    expect(customerGroupInputSchema.safeParse(validManualGroup).success).toBe(true);
  });

  it('validates Vietnamese phone numbers in customer input schema', () => {
    const validCustomer = {
      name: 'Trần Văn B',
      phone: '0912345678',
      email: 'tranvanb@example.com',
      gender: 'MALE' as const,
    };
    expect(customerInputSchema.safeParse(validCustomer).success).toBe(true);

    // Invalid phone number
    expect(
      customerInputSchema.safeParse({
        ...validCustomer,
        phone: '123456',
      }).success,
    ).toBe(false);
  });
});
