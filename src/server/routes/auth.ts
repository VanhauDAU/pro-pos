import { Hono } from 'hono';

import {
  accessStartRequestSchema,
  activationConfirmRequestSchema,
  employeeLoginRequestSchema,
} from '@contracts/auth';
import { AppError } from '@server/lib/app-error';
import {
  clearCredentialCookie,
  readCredentialCookie,
  setCredentialCookie,
} from '@server/lib/cookies';
import { assertCsrf, assertSameOrigin } from '@server/lib/security';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { AuthService } from '@server/services/auth-service';
import { AccessAuthService } from '@server/services/access-auth-service';
import type { AppEnv } from '@server/types';

const authRoutes = new Hono<AppEnv>();

authRoutes.get('/context', async (c) => {
  const service = new AuthService(c.env);
  const rawSession = readCredentialCookie(c, 'session');
  const rawDevice = readCredentialCookie(c, 'device');
  const context = await service.context(rawSession, rawDevice);

  if (rawSession && !context.actor) clearCredentialCookie(c, 'session');
  if (rawDevice && !context.device) clearCredentialCookie(c, 'device');
  if (context.device?.status === 'REVOKED') {
    clearCredentialCookie(c, 'device');
    if (context.actor?.kind === 'EMPLOYEE') clearCredentialCookie(c, 'session');
  }
  const { sessionId: _sessionId, ...publicContext } = context;
  return success(c, publicContext);
});

authRoutes.post('/access/start', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, accessStartRequestSchema);
  const result = await new AccessAuthService(c.env).begin(
    body.deviceId
      ? { purpose: body.purpose, targetDeviceId: body.deviceId }
      : { purpose: body.purpose },
  );
  setCredentialCookie(c, 'access', result.rawState, result.response.expiresInSeconds);
  return success(c, result.response);
});

authRoutes.get('/access/complete', async (c) => {
  const rawState = readCredentialCookie(c, 'access');
  const rawCode = c.req.query('code');
  if (!rawState || !rawCode) {
    clearCredentialCookie(c, 'access');
    throw new AppError('ACCESS_AUTH_REQUIRED', 'Thiếu mã xác thực Access.', 401);
  }

  const service = new AccessAuthService(c.env);
  const failureRedirect = await service.failureRedirect(rawState);
  try {
    const result = await service.exchange({ rawState, rawCode });
    if (result.purpose === 'OWNER_LOGIN') {
      setCredentialCookie(c, 'session', result.rawSession, 7 * 24 * 60 * 60);
    } else if (result.purpose === 'PLATFORM_LOGIN') {
      setCredentialCookie(c, 'session', result.rawSession, 12 * 60 * 60);
    } else if (result.purpose === 'DEVICE_ACTIVATION') {
      setCredentialCookie(c, 'activation', result.rawGrant, 5 * 60);
      clearCredentialCookie(c, 'session');
    } else if (result.purpose === 'DEVICE_REISSUE') {
      setCredentialCookie(c, 'device', result.rawDeviceSecret, 365 * 24 * 60 * 60);
      clearCredentialCookie(c, 'session');
      clearCredentialCookie(c, 'activation');
    } else {
      throw new AppError('ACCESS_AUTH_FAILED', 'Yêu cầu đăng nhập không hợp lệ.', 500);
    }
    clearCredentialCookie(c, 'access');
    return c.redirect(result.redirectTo, 303);
  } catch (error) {
    clearCredentialCookie(c, 'access');
    const target = new URL(failureRedirect, c.req.url);
    target.searchParams.set(
      'authError',
      error instanceof AppError ? error.code : 'ACCESS_AUTH_FAILED',
    );
    console.warn(
      JSON.stringify({
        level: 'warn',
        requestId: c.get('requestId'),
        route: c.req.path,
        code: error instanceof AppError ? error.code : 'ACCESS_AUTH_FAILED',
      }),
    );
    return c.redirect(target.toString(), 303);
  }
});

authRoutes.post('/employee/login', async (c) => {
  assertSameOrigin(c);
  const rawDevice = readCredentialCookie(c, 'device');
  if (!rawDevice) {
    throw new AppError('DEVICE_REQUIRED', 'Thiết bị POS chưa được kích hoạt.', 401);
  }
  const body = await parseJson(c.req.raw, employeeLoginRequestSchema);
  const service = new AuthService(c.env);
  let result;
  try {
    result = await service.employeeLogin({
      rawDeviceSecret: rawDevice,
      username: body.username,
      pin: body.pin,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      ['DEVICE_CREDENTIAL_INVALID', 'DEVICE_REVOKED'].includes(error.code)
    ) {
      clearCredentialCookie(c, 'device');
      clearCredentialCookie(c, 'session');
    }
    throw error;
  }
  setCredentialCookie(c, 'session', result.rawToken, 12 * 60 * 60);
  return success(c, result.response);
});

function buildAccessLogoutUrl(env: CloudflareBindings, finalReturnTo: string): string | null {
  const bridgeUrl = env.ACCESS_BRIDGE_URL;
  if (!bridgeUrl) return null;

  // Cloudflare Access strictly validates that returnTo is an approved Access application.
  // Because ACCESS_BRIDGE_URL is registered in Access while the main app is not,
  // we route through ${bridgeUrl}/logout-callback?target=... which Cloudflare Access permits.
  const bridgeCallbackUrl = `${bridgeUrl}/logout-callback?target=${encodeURIComponent(finalReturnTo)}`;

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  if (teamDomain) {
    return `${teamDomain}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(bridgeCallbackUrl)}`;
  }

  return `${bridgeUrl}/cdn-cgi/access/logout?returnTo=${encodeURIComponent(bridgeCallbackUrl)}`;
}

authRoutes.post('/logout', async (c) => {
  const rawSession = readCredentialCookie(c, 'session');
  let isAccessUser = false;
  if (rawSession) {
    await assertCsrf(c, rawSession);
    const authService = new AuthService(c.env);
    const context = await authService.context(rawSession, readCredentialCookie(c, 'device'));
    await authService.logout(rawSession);
    if (context.actor?.kind === 'OWNER' || context.actor?.kind === 'SUPER_ADMIN') {
      isAccessUser = true;
    }
    if (context.actor?.storeId && context.sessionId) {
      const room = c.env.STORE_REALTIME.getByName(context.actor.storeId);
      c.executionCtx.waitUntil(
        room.disconnectSession(context.actor.storeId, context.sessionId).catch(() => 0),
      );
    }
  } else {
    assertSameOrigin(c);
  }
  clearCredentialCookie(c, 'session');
  clearCredentialCookie(c, 'activation');
  clearCredentialCookie(c, 'access');

  const origin = new URL(c.req.url).origin;
  const returnTo = isAccessUser ? `${origin}/?tab=owner&loggedOut=1` : `${origin}/`;
  const accessLogoutUrl = isAccessUser ? buildAccessLogoutUrl(c.env, returnTo) : null;

  return success(c, {
    loggedOut: true,
    accessLogoutUrl,
  });
});

authRoutes.get('/access/logout', (c) => {
  clearCredentialCookie(c, 'session');
  clearCredentialCookie(c, 'activation');
  clearCredentialCookie(c, 'access');

  const origin = new URL(c.req.url).origin;
  const returnTo = c.req.query('returnTo') || `${origin}/?tab=owner&loggedOut=1`;
  const accessLogoutUrl = buildAccessLogoutUrl(c.env, returnTo) || returnTo;

  return c.redirect(accessLogoutUrl, 303);
});

const activationRoutes = new Hono<AppEnv>();

activationRoutes.get('/context', async (c) => {
  const rawGrant = readCredentialCookie(c, 'activation');
  if (!rawGrant) {
    throw new AppError('ACTIVATION_GRANT_REQUIRED', 'Cần xác thực lại Chủ cửa hàng.', 401);
  }
  return success(c, await new AuthService(c.env).activationContext(rawGrant));
});

activationRoutes.post('/confirm', async (c) => {
  const rawGrant = readCredentialCookie(c, 'activation');
  if (!rawGrant) {
    throw new AppError('ACTIVATION_GRANT_REQUIRED', 'Cần xác thực lại Chủ cửa hàng.', 401);
  }
  await assertCsrf(c, rawGrant);
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Thiếu Idempotency-Key hợp lệ.', 422);
  }
  const body = await parseJson(c.req.raw, activationConfirmRequestSchema);
  const result = await new AuthService(c.env).confirmActivation({
    rawGrant,
    idempotencyKey,
    deviceName: body.deviceName,
  });
  setCredentialCookie(c, 'device', result.rawDeviceSecret, 365 * 24 * 60 * 60);
  clearCredentialCookie(c, 'activation');
  clearCredentialCookie(c, 'session');
  return success(c, result.response, 201);
});

activationRoutes.delete('/current', async (c) => {
  assertSameOrigin(c);
  const rawGrant = readCredentialCookie(c, 'activation');
  if (rawGrant) await new AuthService(c.env).cancelActivation(rawGrant);
  clearCredentialCookie(c, 'activation');
  clearCredentialCookie(c, 'access');
  return success(c, { cancelled: true });
});

export { activationRoutes, authRoutes };
