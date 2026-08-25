import { Hono } from 'hono';
import { z } from 'zod';

import {
  bootstrapSuperAdminSchema,
  createStoreSchema,
  setStoreCapabilitySchema,
  updateStoreMemberSchema,
} from '@contracts/platform';
import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { assertSameOrigin } from '@server/lib/security';
import { parseJson } from '@server/lib/validation';
import { requireActor } from '@server/middleware/authorization';
import { PlatformService } from '@server/services/platform-service';
import { MaintenanceService } from '@server/services/maintenance-service';
import type { AppEnv } from '@server/types';

const platformRoutes = new Hono<AppEnv>();

platformRoutes.post('/bootstrap', async (c) => {
  assertSameOrigin(c);
  const secret = c.req.header('X-Bootstrap-Secret');
  if (!secret) throw new AppError('BOOTSTRAP_FORBIDDEN', 'Không được phép.', 403);
  const body = await parseJson(c.req.raw, bootstrapSuperAdminSchema);
  return success(
    c,
    await new PlatformService(c.env).bootstrap({
      bootstrapSecret: secret,
      ...body,
    }),
    201,
  );
});

platformRoutes.use('/stores/*', requireActor('SUPER_ADMIN'));
platformRoutes.use('/stores', requireActor('SUPER_ADMIN'));
platformRoutes.use('/analytics', requireActor('SUPER_ADMIN'));
platformRoutes.use('/maintenance/*', requireActor('SUPER_ADMIN'));
platformRoutes.use('/maintenance', requireActor('SUPER_ADMIN'));

platformRoutes.get('/analytics', async (c) => {
  const daysParam = c.req.query('days');
  const days = daysParam ? parseInt(daysParam, 10) : 14;
  const result = await new PlatformService(c.env).getPlatformAnalytics(
    Number.isFinite(days) && days > 0 ? days : 14,
  );
  return success(c, result);
});

platformRoutes.get('/stores', async (c) => {
  const result = await new PlatformService(c.env).listStores();
  return success(c, result.results);
});

platformRoutes.get('/stores/:storeId', async (c) => {
  const result = await new PlatformService(c.env).getStoreDetails(c.req.param('storeId'));
  return success(c, result);
});

platformRoutes.post('/stores', async (c) => {
  const body = await parseJson(c.req.raw, createStoreSchema);
  return success(c, await new PlatformService(c.env).createStore(body), 201);
});

platformRoutes.patch('/stores/:storeId/status', async (c) => {
  const body = await parseJson(c.req.raw, z.object({ status: z.enum(['ACTIVE', 'LOCKED']) }));
  return success(
    c,
    await new PlatformService(c.env).setStoreStatus(c.req.param('storeId'), body.status),
  );
});

platformRoutes.delete('/stores/:storeId', async (c) => {
  const storeId = c.req.param('storeId');
  const result = await new PlatformService(c.env).deleteStore(storeId);
  return success(c, result);
});

platformRoutes.patch('/stores/:storeId/capabilities', async (c) => {
  const body = await parseJson(c.req.raw, setStoreCapabilitySchema);
  return success(
    c,
    await new PlatformService(c.env).setStoreCapability({
      storeId: c.req.param('storeId'),
      capability: body.capability,
      enabled: body.enabled,
      actorId: c.get('actor').id,
      requestId: c.get('requestId'),
    }),
  );
});

platformRoutes.patch('/stores/:storeId/members/:userId', async (c) => {
  const body = await parseJson(c.req.raw, updateStoreMemberSchema);
  return success(
    c,
    await new PlatformService(c.env).updateStoreMember({
      storeId: c.req.param('storeId'),
      userId: c.req.param('userId'),
      displayName: body.displayName,
      username: body.username,
      email: body.email,
      phone: body.phone,
      status: body.status,
      newPassword: body.newPassword,
    }),
  );
});

platformRoutes.delete('/stores/:storeId/sessions/:sessionId', async (c) => {
  const storeId = c.req.param('storeId');
  const sessionId = c.req.param('sessionId');
  const result = await new PlatformService(c.env).revokeSession({ storeId, sessionId });
  const room = c.env.STORE_REALTIME.getByName(storeId);
  c.executionCtx.waitUntil(room.disconnectSession(storeId, sessionId).catch(() => 0));
  return success(c, result);
});

platformRoutes.delete('/stores/:storeId/devices/:deviceId', async (c) => {
  const storeId = c.req.param('storeId');
  const deviceId = c.req.param('deviceId');
  const result = await new PlatformService(c.env).revokeDevice({ storeId, deviceId });
  const room = c.env.STORE_REALTIME.getByName(storeId);
  c.executionCtx.waitUntil(room.disconnectDevice(storeId, deviceId).catch(() => 0));
  return success(c, result);
});

platformRoutes.post('/maintenance/cleanup', async (c) => {
  const body = await parseJson(
    c.req.raw,
    z.object({ retentionDays: z.number().int().min(1).max(365).optional() }),
  ).catch(() => ({ retentionDays: 7 }));
  const result = await new MaintenanceService(c.env).runRetentionCleanup(body?.retentionDays ?? 7);
  return success(c, result);
});

export { platformRoutes };
