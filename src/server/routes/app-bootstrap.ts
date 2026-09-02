import { Hono } from 'hono';

import type { AppBootstrapResponse, AppBootstrapSurface } from '@contracts/app-bootstrap';
import { orderWorkspacePermissionKeys } from '@contracts/staff';
import { clearCredentialCookie, readCredentialCookie } from '@server/lib/cookies';
import { measureRequestTiming } from '@server/lib/performance';
import { success } from '@server/lib/response';
import { AuthService } from '@server/services/auth-service';
import { PosService } from '@server/services/pos-service';
import type { AppEnv } from '@server/types';

const appBootstrapRoutes = new Hono<AppEnv>();

function bootstrapSurface(value: string | undefined): AppBootstrapSurface {
  return value === 'shell' ? 'shell' : 'areas';
}

appBootstrapRoutes.get('/bootstrap', async (c) => {
  const rawSession = readCredentialCookie(c, 'session');
  const rawDevice = readCredentialCookie(c, 'device');
  const resolved = await measureRequestTiming(c, 'auth', () =>
    new AuthService(c.env).applicationContext(rawSession, rawDevice),
  );
  const { sessionId: _sessionId, ...resolvedAuth } = resolved.context;
  let auth = resolvedAuth;

  if (rawSession && !auth.actor) clearCredentialCookie(c, 'session');
  if (rawDevice && !auth.device) clearCredentialCookie(c, 'device');
  if (auth.device?.status === 'REVOKED') {
    clearCredentialCookie(c, 'device');
    if (auth.actor?.kind === 'EMPLOYEE') clearCredentialCookie(c, 'session');
  }

  const principal = resolved.principal;
  if (principal?.actor.kind === 'EMPLOYEE' && principal.storeStatus !== 'ACTIVE') {
    if (rawSession) clearCredentialCookie(c, 'session');
    auth = { ...auth, actor: null, csrfToken: null };
    return success(c, { auth, pos: null } satisfies AppBootstrapResponse);
  }
  if (!principal || principal.actor.kind !== 'EMPLOYEE' || !principal.actor.storeId) {
    return success(c, { auth, pos: null } satisfies AppBootstrapResponse);
  }

  const storeId = principal.actor.storeId;
  const permissions = [...principal.permissions];
  const canViewAreas = ['table.view', ...orderWorkspacePermissionKeys].some((permission) =>
    principal.permissions.has(permission),
  );
  const surface = bootstrapSurface(c.req.query('surface'));
  const service = new PosService(c.env);
  const [context, overview] = await Promise.all([
    measureRequestTiming(c, 'pos_context', () =>
      service.getStaffContext(storeId, principal.actor.id, permissions),
    ),
    surface === 'areas' && canViewAreas
      ? measureRequestTiming(c, 'overview', () =>
          service.overview(
            storeId,
            Date.now(),
            (name, durationMs) => {
              const timings = c.get('requestTimings');
              timings[name] = (timings[name] ?? 0) + durationMs;
            },
            c.get('requestId'),
          ),
        )
      : Promise.resolve(null),
  ]);

  if (!context) {
    if (rawSession) clearCredentialCookie(c, 'session');
    return success(c, {
      auth: { ...auth, actor: null, csrfToken: null },
      pos: null,
    } satisfies AppBootstrapResponse);
  }
  return success(c, { auth, pos: { context, overview } } satisfies AppBootstrapResponse);
});

export { appBootstrapRoutes };
