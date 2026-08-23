import { describe, expect, it } from 'vitest';

import {
  createEmployeeSchema,
  employeeBulkActionSchema,
  rolePermissionCatalog,
  updateEmployeeSchema,
} from '@contracts/staff';

describe('POS Staff RBAC Permission Matrix & Schemas', () => {
  it('contains all 4 required staff permissions in rolePermissionCatalog', () => {
    const staffGroup = rolePermissionCatalog
      .find((group) => group.key === 'management')
      ?.sections.find((section) => section.key === 'staff');

    expect(staffGroup).toBeDefined();
    const permissions = staffGroup!.permissions.map(([key]) => key);

    expect(permissions).toContain('staff.employees.view');
    expect(permissions).toContain('staff.employees.edit');
    expect(permissions).toContain('staff.employees.create');
    expect(permissions).toContain('staff.employees.delete');
  });

  it('correctly evaluates staff permissions for employee management actions', () => {
    const checkAccess = (userPermissions: string[], isOwner: boolean) => {
      const perms = userPermissions;
      return {
        canView: isOwner || perms.includes('staff.employees.view'),
        canCreate: isOwner || perms.includes('staff.employees.create'),
        canEdit: isOwner || perms.includes('staff.employees.edit'),
        canDelete: isOwner || perms.includes('staff.employees.delete'),
      };
    };

    // 1. Owner has full permissions unconditionally
    const ownerAccess = checkAccess([], true);
    expect(ownerAccess.canView).toBe(true);
    expect(ownerAccess.canCreate).toBe(true);
    expect(ownerAccess.canEdit).toBe(true);
    expect(ownerAccess.canDelete).toBe(true);

    // 2. Staff with no staff permissions
    const cashierAccess = checkAccess(['order.manage', 'checkout.complete'], false);
    expect(cashierAccess.canView).toBe(false);
    expect(cashierAccess.canCreate).toBe(false);
    expect(cashierAccess.canEdit).toBe(false);
    expect(cashierAccess.canDelete).toBe(false);

    // 3. Staff with only view permission
    const viewerAccess = checkAccess(['staff.employees.view'], false);
    expect(viewerAccess.canView).toBe(true);
    expect(viewerAccess.canCreate).toBe(false);
    expect(viewerAccess.canEdit).toBe(false);
    expect(viewerAccess.canDelete).toBe(false);

    // 4. Staff with create & edit permissions (e.g., Shift Leader / Manager)
    const managerAccess = checkAccess(
      ['staff.employees.view', 'staff.employees.create', 'staff.employees.edit'],
      false,
    );
    expect(managerAccess.canView).toBe(true);
    expect(managerAccess.canCreate).toBe(true);
    expect(managerAccess.canEdit).toBe(true);
    expect(managerAccess.canDelete).toBe(false); // Cannot delete employees

    // 5. Staff with full staff permissions
    const adminStaffAccess = checkAccess(
      ['staff.employees.view', 'staff.employees.create', 'staff.employees.edit', 'staff.employees.delete'],
      false,
    );
    expect(adminStaffAccess.canView).toBe(true);
    expect(adminStaffAccess.canCreate).toBe(true);
    expect(adminStaffAccess.canEdit).toBe(true);
    expect(adminStaffAccess.canDelete).toBe(true);
  });

  it('validates create employee schema correctly', () => {
    const validEmployee = {
      displayName: 'Nguyễn Văn Nhân Viên',
      username: 'nhanvien01',
      email: 'nhanvien01@example.com',
      pin: '1234',
      permissionKeys: [],
    };
    expect(createEmployeeSchema.safeParse(validEmployee).success).toBe(true);

    // Invalid PIN (not 4 digits)
    expect(
      createEmployeeSchema.safeParse({
        ...validEmployee,
        pin: '123',
      }).success,
    ).toBe(false);

    expect(
      createEmployeeSchema.safeParse({
        ...validEmployee,
        pin: '12345',
      }).success,
    ).toBe(false);

    expect(
      createEmployeeSchema.safeParse({
        ...validEmployee,
        pin: 'abcd',
      }).success,
    ).toBe(false);

    // Invalid empty display name
    expect(
      createEmployeeSchema.safeParse({
        ...validEmployee,
        displayName: '',
      }).success,
    ).toBe(false);

    // Invalid short username
    expect(
      createEmployeeSchema.safeParse({
        ...validEmployee,
        username: 'ab',
      }).success,
    ).toBe(false);
  });

  it('validates update employee schema correctly', () => {
    const validUpdate = {
      displayName: 'Nguyễn Văn Đã Đổi Tên',
      email: 'newemail@example.com',
      roleId: 'c3c9b740-4277-4b7c-87d9-9599d14fbf8e',
      pin: '5678',
    };
    expect(updateEmployeeSchema.safeParse(validUpdate).success).toBe(true);

    // Valid update without changing PIN
    expect(
      updateEmployeeSchema.safeParse({
        displayName: 'Nguyễn Văn Đã Đổi Tên',
        email: null,
        roleId: 'c3c9b740-4277-4b7c-87d9-9599d14fbf8e',
      }).success,
    ).toBe(true);
  });

  it('validates bulk action schema for all allowed actions', () => {
    const userIds = ['c3c9b740-4277-4b7c-87d9-9599d14fbf8e'];

    expect(employeeBulkActionSchema.safeParse({ userIds, action: 'ACTIVATE' }).success).toBe(true);
    expect(employeeBulkActionSchema.safeParse({ userIds, action: 'DISABLE' }).success).toBe(true);
    expect(employeeBulkActionSchema.safeParse({ userIds, action: 'DELETE' }).success).toBe(true);
    expect(
      employeeBulkActionSchema.safeParse({ userIds, action: 'REVOKE_SESSIONS' }).success,
    ).toBe(true);

    // Invalid action
    expect(
      employeeBulkActionSchema.safeParse({ userIds, action: 'INVALID_ACTION' }).success,
    ).toBe(false);

    // Empty userIds
    expect(employeeBulkActionSchema.safeParse({ userIds: [], action: 'ACTIVATE' }).success).toBe(
      false,
    );
  });
});
