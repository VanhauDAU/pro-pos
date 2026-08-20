import { AppError } from '@server/lib/app-error';
import { derivePasswordDigest, randomSalt } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import { StaffRepository } from '@server/repositories/staff-repository';

const DEFAULT_EMPLOYEE_PERMISSIONS = [
  'table.view',
  'table.open',
  'order.manage',
  'checkout.complete',
  'invoice.view',
  'invoice.print',
];

export class StaffService {
  private readonly repository: StaffRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new StaffRepository(env.DB);
  }

  async createEmployee(input: {
    storeId: string;
    displayName: string;
    username: string;
    pin: string;
    permissionKeys: string[];
  }) {
    const userId = crypto.randomUUID();
    const salt = randomSalt();
    const workFactor = Number(this.env.AUTH_PBKDF2_ITERATIONS);
    const permissions =
      input.permissionKeys.length > 0
        ? Array.from(new Set(input.permissionKeys))
        : DEFAULT_EMPLOYEE_PERMISSIONS;
    if (!Number.isInteger(workFactor) || workFactor <= 0) {
      throw new AppError('SERVER_MISCONFIGURED', 'Invalid auth work factor.', 503);
    }
    await this.repository.createEmployee({
      storeId: input.storeId,
      userId,
      membershipId: crypto.randomUUID(),
      roleId: crypto.randomUUID(),
      roleCode: `EMPLOYEE_${userId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      displayName: input.displayName.trim(),
      username: input.username.trim().toLocaleLowerCase('en-US'),
      permissionKeys: permissions,
      workFactor,
      salt,
      digest: await derivePasswordDigest({
        secret: input.pin,
        pepper: requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER'),
        salt,
        iterations: workFactor,
      }),
      now: Date.now(),
    });
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

  async setEmployeeStatus(storeId: string, userId: string, status: 'ACTIVE' | 'DISABLED') {
    await this.repository.setEmployeeStatus(storeId, userId, status, Date.now());
    return { userId, status };
  }

  async resetPin(storeId: string, userId: string, pin: string) {
    const salt = randomSalt();
    const workFactor = Number(this.env.AUTH_PBKDF2_ITERATIONS);
    const result = await this.repository.resetPin({
      storeId,
      userId,
      workFactor,
      salt,
      digest: await derivePasswordDigest({
        secret: pin,
        pepper: requireSecret(this.env.AUTH_PEPPER, 'AUTH_PEPPER'),
        salt,
        iterations: workFactor,
      }),
      now: Date.now(),
    });
    if ((result[0]?.meta.changes ?? 0) !== 1) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân viên.', 404);
    }
    return { userId, pinReset: true };
  }
}
