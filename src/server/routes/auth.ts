import { Hono } from 'hono';

import {
  activationConfirmRequestSchema,
  activationReissueRequestSchema,
  employeeLoginRequestSchema,
  ownerLoginRequestSchema,
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
  return success(c, context);
});

authRoutes.post('/owner/login', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, ownerLoginRequestSchema);
  const service = new AuthService(c.env);
  const result = await service.ownerLogin(body.username, body.password);
  setCredentialCookie(c, 'session', result.rawToken, 7 * 24 * 60 * 60);
  return success(c, result.response);
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
      employeeId: body.employeeId,
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

authRoutes.post('/logout', async (c) => {
  const rawSession = readCredentialCookie(c, 'session');
  if (rawSession) {
    await assertCsrf(c, rawSession);
    await new AuthService(c.env).logout(rawSession);
  } else {
    assertSameOrigin(c);
  }
  clearCredentialCookie(c, 'session');
  return success(c, { loggedOut: true });
});

const activationRoutes = new Hono<AppEnv>();

activationRoutes.post('/authorize', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, ownerLoginRequestSchema);
  const result = await new AuthService(c.env).authorizeActivation(body.username, body.password);
  setCredentialCookie(c, 'activation', result.rawGrant, result.response.expiresInSeconds);
  return success(c, result.response);
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

activationRoutes.post('/reissue', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, activationReissueRequestSchema);
  const result = await new AuthService(c.env).reissueDevice(body);
  setCredentialCookie(c, 'device', result.rawDeviceSecret, 365 * 24 * 60 * 60);
  clearCredentialCookie(c, 'session');
  clearCredentialCookie(c, 'activation');
  return success(c, { device: result.device });
});

activationRoutes.delete('/current', async (c) => {
  assertSameOrigin(c);
  const rawGrant = readCredentialCookie(c, 'activation');
  if (rawGrant) await new AuthService(c.env).cancelActivation(rawGrant);
  clearCredentialCookie(c, 'activation');
  return success(c, { cancelled: true });
});

export { activationRoutes, authRoutes };
