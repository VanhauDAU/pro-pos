import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthorizationRepository } from '@server/repositories/authorization-repository';
import { PlatformService } from '@server/services/platform-service';
import { StaffService } from '@server/services/staff-service';

describe('Owner staff and role management', () => {
  let storeId: string;
  let staff: StaffService;
  let employeeRoleId: string;

  beforeAll(async () => {
    const store = await new PlatformService(env).createStore({
      name: 'Staff Roles Store',
      ownerDisplayName: 'Staff Owner',
      ownerEmail: 'staff.roles.owner@example.com',
    });
    storeId = store.storeId;
    staff = new StaffService(env);
    const roles = await staff.listRoles(storeId);
    employeeRoleId = roles.find((role) => role.code === 'EMPLOYEE')!.id;
  });

  it('starts every store with the default employee role', async () => {
    const roles = await staff.listRoles(storeId);
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EMPLOYEE', name: 'Nhân viên', isSystem: 1 }),
      ]),
    );
    expect((await staff.getRole(storeId, employeeRoleId)).permissionKeys).toContain('order.create');
  });

  it('creates a custom role with only selected supported permissions', async () => {
    const created = await staff.createRole(storeId, 'Thu ngân', [
      'order.create',
      'checkout.complete',
      'invoice.view',
    ]);
    const detail = await staff.getRole(storeId, created.id);
    expect(detail.permissionKeys.toSorted()).toEqual([
      'checkout.complete',
      'invoice.view',
      'order.create',
    ]);
  });

  it('creates, updates, disables and deletes an employee without changing username', async () => {
    const employee = await staff.createEmployee({
      storeId,
      displayName: 'Nguyễn Nhân viên',
      username: 'staff.roles.user',
      email: 'staff.roles.user@example.com',
      pin: '1234',
      roleId: employeeRoleId,
      permissionKeys: [],
    });
    const before = await staff.getEmployee(storeId, employee.userId);
    expect(before).toMatchObject({
      username: 'staff.roles.user',
      email: 'staff.roles.user@example.com',
      roleId: employeeRoleId,
      status: 'ACTIVE',
    });

    const customRoles = await staff.listRoles(storeId);
    const cashierRole = customRoles.find((role) => role.name === 'Thu ngân')!;
    await staff.updateEmployee(storeId, employee.userId, {
      displayName: 'Nhân viên đã sửa',
      email: null,
      roleId: cashierRole.id,
      pin: '5678',
    });
    const updated = await staff.getEmployee(storeId, employee.userId);
    expect(updated).toMatchObject({
      displayName: 'Nhân viên đã sửa',
      username: 'staff.roles.user',
      email: null,
      roleId: cashierRole.id,
    });

    await staff.bulkAction(storeId, [employee.userId], 'DISABLE');
    expect((await staff.getEmployee(storeId, employee.userId)).status).toBe('DISABLED');
    await staff.bulkAction(storeId, [employee.userId], 'ACTIVATE');
    expect((await staff.getEmployee(storeId, employee.userId)).status).toBe('ACTIVE');

    await staff.deleteEmployee(storeId, employee.userId);
    await expect(staff.getEmployee(storeId, employee.userId)).rejects.toMatchObject({
      code: 'EMPLOYEE_NOT_FOUND',
    });
    expect((await staff.listEmployees(storeId)).some((item) => item.id === employee.userId)).toBe(
      false,
    );
  });

  it('protects system roles and prevents deleting a role assigned to an employee', async () => {
    const employeeRole = (await staff.listRoles(storeId)).find((role) => role.code === 'EMPLOYEE')!;
    await expect(staff.deleteRole(storeId, employeeRole.id)).rejects.toMatchObject({
      code: 'ROLE_PROTECTED',
    });
  });

  it('allows creating an employee with catalog permissions to manage products and categories', async () => {
    const catalogRole = await staff.createRole(storeId, 'Quản lý kho món', [
      'catalog.products.view',
      'catalog.products.create',
    ]);
    const employee = await staff.createEmployee({
      storeId,
      displayName: 'Nhân viên Quản lý Món',
      username: 'catalog.manager',
      pin: '9999',
      roleId: catalogRole.id,
      permissionKeys: [],
    });
    const authRepo = new AuthorizationRepository(env.DB);
    expect(await authRepo.hasPermission(storeId, employee.userId, 'catalog.manage')).toBe(true);
  });
});
