import { Hono } from 'hono';

import { AppError } from '@server/lib/app-error';
import { clearCredentialCookie } from '@server/lib/cookies';
import { success } from '@server/lib/response';
import { assertSameStore } from '@server/lib/tenant';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { AuthService } from '@server/services/auth-service';
import type { AppEnv } from '@server/types';

const ownerDeviceRoutes = new Hono<AppEnv>();
ownerDeviceRoutes.use('*', requireActor('OWNER'));
ownerDeviceRoutes.use('*', requirePermission('device.manage'));

ownerDeviceRoutes.get('/', async (c) =>
  success(c, await new AuthService(c.env).listDevices(c.get('actor').storeId!)),
);

ownerDeviceRoutes.post('/:deviceId/revoke', async (c) => {
  const actor = c.get('actor');
  const deviceId = c.req.param('deviceId');
  const result = await new AuthService(c.env).revokeDevice(actor.storeId!, deviceId, {
    actorUserId: actor.id,
    actorSessionId: c.get('sessionId'),
    deviceId: c.get('device')?.id ?? null,
    requestId: c.get('requestId'),
  });
  const room = c.env.STORE_REALTIME.getByName(actor.storeId!);
  c.executionCtx.waitUntil(room.disconnectDevice(actor.storeId!, deviceId).catch(() => 0));
  return success(c, result);
});

const currentDeviceRoutes = new Hono<AppEnv>();
currentDeviceRoutes.use('*', requireActor('OWNER'));
currentDeviceRoutes.post('/revoke', requirePermission('device.manage'), async (c) => {
  const device = c.get('device');
  if (!device || device.status !== 'ACTIVE') {
    throw new AppError('DEVICE_REQUIRED', 'Thiết bị POS chưa được kích hoạt.', 401);
  }
  const actor = c.get('actor');
  assertSameStore(actor.storeId!, device.storeId);
  const result = await new AuthService(c.env).revokeDevice(actor.storeId!, device.id, {
    actorUserId: actor.id,
    actorSessionId: c.get('sessionId'),
    deviceId: device.id,
    requestId: c.get('requestId'),
  });
  const room = c.env.STORE_REALTIME.getByName(actor.storeId!);
  c.executionCtx.waitUntil(room.disconnectDevice(actor.storeId!, device.id).catch(() => 0));
  clearCredentialCookie(c, 'device');
  return success(c, result);
});

export { currentDeviceRoutes, ownerDeviceRoutes };
