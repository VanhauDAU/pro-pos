import type { MiddlewareHandler } from 'hono';

import { AppError } from '@server/lib/app-error';
import { readCredentialCookie } from '@server/lib/cookies';
import { assertCsrf } from '@server/lib/security';
import { AuthorizationRepository } from '@server/repositories/authorization-repository';
import { AuthService } from '@server/services/auth-service';
import { PrintAgentService } from '@server/services/print-agent-service';
import type { AppEnv } from '@server/types';
import { measureRequestTiming } from '@server/lib/performance';

export function requireActor(
  ...allowedKinds: Array<'SUPER_ADMIN' | 'OWNER' | 'EMPLOYEE'>
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const rawSession = readCredentialCookie(c, 'session');
    if (!rawSession) {
      throw new AppError('AUTH_REQUIRED', 'Vui lòng đăng nhập.', 401);
    }
    const rawDevice = readCredentialCookie(c, 'device');
    const context = await measureRequestTiming(c, 'auth', () =>
      new AuthService(c.env).context(rawSession, rawDevice),
    );
    if (!context.actor || !allowedKinds.includes(context.actor.kind)) {
      throw new AppError('AUTH_REQUIRED', 'Phiên đăng nhập không hợp lệ.', 401);
    }
    if (context.actor.storeId) {
      const store = await measureRequestTiming(c, 'store', () =>
        new AuthorizationRepository(c.env.DB).getStoreStatus(context.actor!.storeId!),
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

export function requireActorOrPrintAgent(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const agentId = c.req.header('X-Agent-Id') || c.req.query('agentId');
    const agentSecret = c.req.header('X-Agent-Secret') || c.req.query('agentSecret');

    if (agentId && agentSecret) {
      const agentService = new PrintAgentService(c.env);
      const agent = await agentService.verifyAgent(agentId, agentSecret);
      const store = await new AuthorizationRepository(c.env.DB).getStoreStatus(agent.store_id);
      if (!store || store.status !== 'ACTIVE') {
        throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
      }
      c.set('actor', {
        id: agent.id,
        kind: 'EMPLOYEE',
        storeId: agent.store_id,
        displayName: agent.device_name,
      });
      c.set('device', { id: agent.id, deviceName: agent.device_name } as any);
      c.set('sessionId', `agent-session-${agent.id}`);
      return next();
    }

    return requireActor('OWNER', 'EMPLOYEE')(c, next);
  };
}

export function requirePermission(...permissionKeys: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await assertPermission(c, ...permissionKeys);
    await next();
  };
}

export async function assertPermission(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  ...permissionKeys: string[]
): Promise<void> {
  const agentId = c.req.header('X-Agent-Id') || c.req.query('agentId');
  if (agentId) {
    // Verified Print Agent has implicit print permissions for its bound store
    return;
  }

  const actor = c.get('actor');
  if (actor.kind === 'OWNER') {
    return;
  }
  if (!actor.storeId) {
    throw new AppError('STORE_CONTEXT_REQUIRED', 'Thiếu ngữ cảnh cửa hàng.', 403);
  }
  const allowed = await measureRequestTiming(c, 'permission', () =>
    new AuthorizationRepository(c.env.DB).hasPermission(actor.storeId!, actor.id, permissionKeys),
  );
  if (!allowed) {
    throw new AppError('PERMISSION_DENIED', 'Bạn không có quyền thực hiện thao tác này.', 403);
  }
}
