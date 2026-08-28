import { AppError } from '@server/lib/app-error';
import { derivePinDigest, randomSalt } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { StaffRepository } from '@server/repositories/staff-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';
import { RoleRepository } from '@server/repositories/role-repository';
import type { updateEmployeeSchema } from '@contracts/staff';
import { rolePermissionKeys } from '@contracts/staff';
import type { z } from 'zod';

const DEFAULT_EMPLOYEE_PERMISSIONS = [
  'table.view',
  'table.open',
  'order.create',
  'checkout.complete',
  'invoice.view',
  'invoice.print',
];

function expandRuntimePermissions(permissionKeys: string[]) {
  return [...new Set(permissionKeys)];
}

export class StaffService {
  private readonly repository: StaffRepository;
  private readonly roles: RoleRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new StaffRepository(env.DB);
    this.roles = new RoleRepository(env.DB);
  }

  async createEmployee(input: {
    storeId: string;
    displayName: string;
    username: string;
    email?: string | null;
    pin: string;
    roleId?: string;
    permissionKeys: string[];
    auditContext?: AuditContext;
  }) {
    const userId = crypto.randomUUID();
    const salt = randomSalt();
    let roleId = input.roleId;
    let createRole = false;
    let permissions = Array.from(new Set(input.permissionKeys));
    if (!roleId) {
      roleId = crypto.randomUUID();
      createRole = true;
      permissions = permissions.length > 0 ? permissions : DEFAULT_EMPLOYEE_PERMISSIONS;
    } else {
      await this.assertRole(input.storeId, roleId);
    }
    try {
      await this.repository.createEmployee({
        storeId: input.storeId,
        userId,
        membershipId: crypto.randomUUID(),
        roleId,
        ...(createRole
          ? {
              roleCode: `EMPLOYEE_${userId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
              roleName: `Quyền ${input.displayName.trim()}`,
            }
          : {}),
        displayName: input.displayName.trim(),
        email: input.email?.trim().toLocaleLowerCase('en-US') || null,
        username: input.username.trim().toLocaleLowerCase('en-US'),
        permissionKeys: permissions,
        createRole,
        salt,
        digest: await derivePinDigest({
          pin: input.pin,
          pepper: requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER'),
          salt,
          userId,
          storeId: input.storeId,
        }),
        now: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed:')) {
        throw new AppError(
          'USERNAME_CONFLICT',
          'Tên đăng nhập đã tồn tại trong cửa hàng này.',
          409,
        );
      }
      throw error;
    }
    if (input.auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId: input.storeId,
        context: input.auditContext,
        action: 'STAFF_CREATED',
        entityType: 'USER',
        entityId: userId,
        before: null,
        after: {
          displayName: input.displayName.trim(),
          username: input.username.trim().toLocaleLowerCase('en-US'),
          email: input.email?.trim().toLocaleLowerCase('en-US') || null,
          roleId,
          permissionKeys: permissions,
          status: 'ACTIVE',
        },
        now: Date.now(),
      });
    }
    return { userId };
  }

  async listEmployees(storeId: string) {
    const result = await this.repository.listEmployees(storeId);
    return result.results.map((row) =>
      Object.assign(row, {
        permissionKeys:
          typeof row.permissionKeys === 'string' && row.permissionKeys.length > 0
            ? row.permissionKeys.split(',')
            : [],
      }),
    );
  }

  async getEmployee(storeId: string, userId: string) {
    const employee = await this.repository.getEmployee(storeId, userId);
    if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    return {
      ...employee,
      status:
        employee.userStatus === 'ACTIVE' && employee.membershipStatus === 'ACTIVE'
          ? 'ACTIVE'
          : 'DISABLED',
    };
  }

  private async assertRole(storeId: string, roleId: string) {
    const role = await this.roles.getRole(storeId, roleId);
    if (!role) throw new AppError('ROLE_NOT_FOUND', 'Không tìm thấy vai trò.', 404);
    return role;
  }

  async updateEmployee(
    storeId: string,
    userId: string,
    input: z.infer<typeof updateEmployeeSchema>,
    auditContext?: AuditContext,
  ) {
    const before = await this.repository.getEmployee(storeId, userId);
    if (!before) throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    await this.assertRole(storeId, input.roleId);
    const now = Date.now();
    let salt: string | undefined;
    let digest: string | undefined;
    if (input.pin) {
      salt = randomSalt();
      digest = await derivePinDigest({
        pin: input.pin,
        pepper: requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER'),
        salt,
        userId,
        storeId,
      });
    }
    const result = await this.repository.updateEmployee({
      storeId,
      userId,
      displayName: input.displayName.trim(),
      email: input.email?.trim().toLocaleLowerCase('en-US') || null,
      roleId: input.roleId,
      now,
      ...(salt && digest ? { salt, digest } : {}),
    });
    if ((result[0]?.meta.changes ?? 0) !== 1 || (result[1]?.meta.changes ?? 0) !== 1) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'STAFF_UPDATED',
        entityType: 'USER',
        entityId: userId,
        before: { displayName: before.displayName, email: before.email, roleId: before.roleId },
        after: {
          displayName: input.displayName.trim(),
          email: input.email ?? null,
          roleId: input.roleId,
        },
        now,
      });
    }
    return { userId, updated: true, pinUpdated: Boolean(input.pin) };
  }

  async deleteEmployee(storeId: string, userId: string, auditContext?: AuditContext) {
    const target = await this.repository.findEmployeeTarget(storeId, userId);
    if (!target) throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    const result = await this.repository.softDeleteEmployee(storeId, userId, Date.now());
    if ((result[0]?.meta.changes ?? 0) !== 1) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'STAFF_DELETED',
        entityType: 'USER',
        entityId: userId,
        before: { status: target.status },
        after: { status: 'DISABLED' },
        now: Date.now(),
      });
    }
    return { userId, deleted: true };
  }

  async terminateSessions(storeId: string, userId: string, auditContext?: AuditContext) {
    const target = await this.repository.findEmployeeTarget(storeId, userId);
    if (!target) throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    const result = await this.repository.terminateSessions(storeId, userId, Date.now());
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'STAFF_SESSIONS_TERMINATED',
        entityType: 'USER',
        entityId: userId,
        before: null,
        after: { sessionsTerminated: result.results.length },
        now: Date.now(),
      });
    }
    return {
      userId,
      sessionsTerminated: result.results.length,
      sessionIds: result.results.map((session) => session.id),
    };
  }

  async bulkAction(
    storeId: string,
    userIds: string[],
    action: 'ACTIVATE' | 'DISABLE' | 'DELETE' | 'REVOKE_SESSIONS',
    auditContext?: AuditContext,
  ) {
    const results = await Promise.all(
      Array.from(new Set(userIds)).map((userId) => {
        if (action === 'REVOKE_SESSIONS') {
          return this.terminateSessions(storeId, userId, auditContext);
        }
        if (action === 'DELETE') {
          return this.deleteEmployee(storeId, userId, auditContext);
        }
        return this.setEmployeeStatus(
          storeId,
          userId,
          action === 'ACTIVATE' ? 'ACTIVE' : 'DISABLED',
          auditContext,
        );
      }),
    );
    return { action, count: results.length };
  }

  async listRoles(storeId: string) {
    const result = await this.roles.listRoles(storeId);
    const visible = new Set<string>(rolePermissionKeys);
    return Promise.all(
      result.results.map(async (role) => {
        const detail = await this.roles.getRole(storeId, role.id);
        const permissionCount = (detail?.permissionKeys?.split(',') ?? []).filter((key) =>
          visible.has(key),
        ).length;
        return Object.assign(role, { permissionCount });
      }),
    );
  }

  async getRole(storeId: string, roleId: string) {
    const role = await this.roles.getRole(storeId, roleId);
    if (!role) throw new AppError('ROLE_NOT_FOUND', 'Không tìm thấy vai trò.', 404);
    return {
      ...role,
      permissionKeys: role.permissionKeys
        ? role.permissionKeys
            .split(',')
            .filter((key) => new Set<string>(rolePermissionKeys).has(key))
        : [],
    };
  }

  async createRole(
    storeId: string,
    name: string,
    permissionKeys: string[],
    auditContext?: AuditContext,
  ) {
    const keys = Array.from(new Set(permissionKeys));
    await this.assertPermissions(keys);
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.roles.createRole({
      id,
      code: `CUSTOM_${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      storeId,
      name: name.trim(),
      permissionKeys: expandRuntimePermissions(keys),
      now,
    });
    if (auditContext)
      await this.auditRole(
        storeId,
        auditContext,
        'ROLE_CREATED',
        id,
        null,
        { name, permissionKeys: keys },
        now,
      );
    return { id };
  }

  async updateRole(
    storeId: string,
    roleId: string,
    name: string,
    permissionKeys: string[],
    auditContext?: AuditContext,
  ) {
    const before = await this.roles.getRole(storeId, roleId);
    if (!before) throw new AppError('ROLE_NOT_FOUND', 'Không tìm thấy vai trò.', 404);
    if (before.code === 'OWNER')
      throw new AppError('ROLE_PROTECTED', 'Không thể sửa vai trò chủ cửa hàng.', 403);
    const keys = Array.from(new Set(permissionKeys));
    await this.assertPermissions(keys);
    const now = Date.now();
    await this.roles.updateRole({
      id: roleId,
      storeId,
      name: name.trim(),
      permissionKeys: expandRuntimePermissions(keys),
      now,
    });
    if (auditContext)
      await this.auditRole(
        storeId,
        auditContext,
        'ROLE_UPDATED',
        roleId,
        before,
        { name, permissionKeys: keys },
        now,
      );
    return { id: roleId, updated: true };
  }

  async deleteRole(storeId: string, roleId: string, auditContext?: AuditContext) {
    const before = await this.roles.getRole(storeId, roleId);
    if (!before) throw new AppError('ROLE_NOT_FOUND', 'Không tìm thấy vai trò.', 404);
    if (before.isSystem === 1 || before.code === 'OWNER') {
      throw new AppError('ROLE_PROTECTED', 'Không thể xóa vai trò mặc định.', 409);
    }
    const members = await this.roles.findRoleMembershipCount(storeId, roleId);
    if ((members?.count ?? 0) > 0) {
      throw new AppError('ROLE_IN_USE', 'Không thể xóa vai trò đang được sử dụng.', 409);
    }
    const result = await this.roles.deleteRole(storeId, roleId);
    if ((result[1]?.meta.changes ?? 0) !== 1)
      throw new AppError('ROLE_NOT_FOUND', 'Không tìm thấy vai trò.', 404);
    if (auditContext)
      await this.auditRole(storeId, auditContext, 'ROLE_DELETED', roleId, before, null, Date.now());
    return { id: roleId, deleted: true };
  }

  async assertPermissions(permissionKeys: string[]) {
    const allowed = new Set<string>(rolePermissionKeys);
    if (permissionKeys.some((key) => !allowed.has(key))) {
      throw new AppError('PERMISSION_INVALID', 'Danh sách quyền không hợp lệ.', 422);
    }
    const result = await this.roles.countPermissions(permissionKeys);
    if (result.results.length !== permissionKeys.length) {
      throw new AppError('PERMISSION_INVALID', 'Danh sách quyền chưa được hỗ trợ.', 422);
    }
  }

  private auditRole(
    storeId: string,
    context: AuditContext,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
    now: number,
  ) {
    return new AuditRepository(this.env.DB).record({
      storeId,
      context,
      action,
      entityType: 'ROLE',
      entityId: id,
      before,
      after,
      now,
    });
  }

  permissionCatalog() {
    return rolePermissionKeys;
  }

  async setEmployeeStatus(
    storeId: string,
    userId: string,
    status: 'ACTIVE' | 'DISABLED',
    auditContext?: AuditContext,
  ) {
    const target = await this.repository.findEmployeeTarget(storeId, userId);
    if (!target) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    }
    const result = await this.repository.setEmployeeStatus(storeId, userId, status, Date.now());
    if ((result[0]?.meta.changes ?? 0) !== 1 || (result[1]?.meta.changes ?? 0) !== 1) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'STAFF_STATUS_CHANGED',
        entityType: 'USER',
        entityId: userId,
        before: { status: target.status, membershipStatus: target.membershipStatus },
        after: { status },
        now: Date.now(),
      });
    }
    return { userId, status };
  }

  async resetPin(storeId: string, userId: string, pin: string, auditContext?: AuditContext) {
    const target = await this.repository.findEmployeeTarget(storeId, userId);
    if (!target) throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    const salt = randomSalt();
    const result = await this.repository.resetPin({
      storeId,
      userId,
      salt,
      digest: await derivePinDigest({
        pin,
        pepper: requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER'),
        salt,
        userId,
        storeId,
      }),
      now: Date.now(),
    });
    if ((result[0]?.meta.changes ?? 0) !== 1) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    }
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'STAFF_PIN_RESET',
        entityType: 'USER',
        entityId: userId,
        before: null,
        after: { pinReset: true },
        now: Date.now(),
      });
    }
    return { userId, pinReset: true };
  }
}
