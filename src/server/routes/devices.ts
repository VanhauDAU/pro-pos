import { Hono } from 'hono';

import { AppError } from '@server/lib/app-error';
import { clearCredentialCookie } from '@server/lib/cookies';
import { success } from '@server/lib/response';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { AuthService } from '@server/services/auth-service';
import type { AppEnv } from '@server/types';

const ownerDeviceRoutes = new Hono<AppEnv>();
ownerDeviceRoutes.use('*', requireActor('OWNER'));
ownerDeviceRoutes.use('*', requirePermission('device.manage'));

ownerDeviceRoutes.get('/', async (c) =>
  success(c, await new AuthService(c.env).listDevices(c.get('actor').storeId!)),
);

ownerDeviceRoutes.post('/:deviceId/revoke', async (c) =>
  success(
    c,
    await new AuthService(c.env).revokeDevice(c.get('actor').storeId!, c.req.param('deviceId')),
  ),
);

const currentDeviceRoutes = new Hono<AppEnv>();
currentDeviceRoutes.use('*', requireActor('OWNER'));
currentDeviceRoutes.post('/revoke', requirePermission('device.manage'), async (c) => {
  const device = c.get('device');
  if (!device || device.status !== 'ACTIVE') {
    throw new AppError('DEVICE_REQUIRED', 'Thiết bị POS chưa được kích hoạt.', 401);
  }
  const result = await new AuthService(c.env).revokeDevice(device.storeId, device.id);
  clearCredentialCookie(c, 'device');
  return success(c, result);
});

export { currentDeviceRoutes, ownerDeviceRoutes };
