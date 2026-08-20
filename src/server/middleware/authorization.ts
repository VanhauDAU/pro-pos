import type { MiddlewareHandler } from 'hono';

import { AppError } from '@server/lib/app-error';
import { readCredentialCookie } from '@server/lib/cookies';
import { assertCsrf } from '@server/lib/security';
import { AuthorizationRepository } from '@server/repositories/authorization-repository';
import { AuthService } from '@server/services/auth-service';
import type { AppEnv } from '@server/types';

export function requireActor(
  ...allowedKinds: Array<'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE'>
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const rawSession = readCredentialCookie(c, 'session');
    if (!rawSession) {
      throw new AppError('AUTH_REQUIRED', 'Vui lòng đăng nhập.', 401);
    }
    const rawDevice = readCredentialCookie(c, 'device');
    const context = await new AuthService(c.env).context(rawSession, rawDevice);
    if (!context.actor || !allowedKinds.includes(context.actor.kind)) {
      throw new AppError('AUTH_REQUIRED', 'Phiên đăng nhập không hợp lệ.', 401);
    }
    if (context.actor.storeId) {
      const store = await new AuthorizationRepository(c.env.DB).getStoreStatus(
        context.actor.storeId,
      );
      if (!store || store.status !== 'ACTIVE') {
        throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      await assertCsrf(c, rawSession);
    }
    c.set('actor', context.actor);
    c.set('device', context.device);
    c.set('rawSession', rawSession);
    c.set('sessionId', context.sessionId!);
    await next();
  };
}

export function requirePermission(permissionKey: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await assertPermission(c, permissionKey);
    await next();
  };
}

export async function assertPermission(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  permissionKey: string,
): Promise<void> {
  const actor = c.get('actor');
  if (!actor.storeId) {
    throw new AppError('STORE_CONTEXT_REQUIRED', 'Thiếu ngữ cảnh cửa hàng.', 403);
  }
  const allowed = await new AuthorizationRepository(c.env.DB).hasPermission(
    actor.storeId,
    actor.id,
    permissionKey,
  );
  if (!allowed) {
    throw new AppError('PERMISSION_DENIED', 'Bạn không có quyền thực hiện thao tác này.', 403);
  }
}
