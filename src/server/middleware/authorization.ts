import type { MiddlewareHandler } from 'hono';

import { AppError } from '@server/lib/app-error';
import { readCredentialCookie } from '@server/lib/cookies';
import { assertCsrf } from '@server/lib/security';
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
    const principal = await measureRequestTiming(c, 'auth', () =>
      new AuthService(c.env).requestPrincipal(rawSession, rawDevice),
    );
    if (!principal || !allowedKinds.includes(principal.actor.kind)) {
      throw new AppError('AUTH_REQUIRED', 'Phiên đăng nhập không hợp lệ.', 401);
    }
    if (principal.actor.storeId && principal.storeStatus !== 'ACTIVE') {
      throw new AppError('STORE_LOCKED', 'Cửa hàng đang bị khóa.', 403);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      await assertCsrf(c, rawSession);
    }
    c.set('principal', principal);
    c.set('actor', principal.actor);
    c.set('device', principal.device);
    c.set('rawSession', rawSession);
    c.set('sessionId', principal.sessionId);
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
      c.set('actor', {
        id: agent.id,
        kind: 'EMPLOYEE',
        storeId: agent.store_id,
        displayName: agent.device_name,
      });
      c.set('device', { id: agent.id, deviceName: agent.device_name } as any);
      c.set('sessionId', `agent-session-${agent.id}`);
      c.set('principal', null);
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
  const principal = c.get('principal');
  const allowed = permissionKeys.some((permissionKey) => principal?.permissions.has(permissionKey));
  if (!allowed) {
    throw new AppError('PERMISSION_DENIED', 'Bạn không có quyền thực hiện thao tác này.', 403);
  }
}
