import { Hono } from 'hono';
import { z } from 'zod';

import { bootstrapSuperAdminSchema, createStoreSchema } from '@contracts/platform';
import { AppError } from '@server/lib/app-error';
import { setCredentialCookie } from '@server/lib/cookies';
import { success } from '@server/lib/response';
import { assertSameOrigin } from '@server/lib/security';
import { parseJson } from '@server/lib/validation';
import { requireActor } from '@server/middleware/authorization';
import { PlatformService } from '@server/services/platform-service';
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

platformRoutes.post('/auth/login', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(
    c.req.raw,
    z.object({ username: z.string().min(1), password: z.string().min(1).max(256) }),
  );
  const result = await new PlatformService(c.env).login(body.username, body.password);
  setCredentialCookie(c, 'session', result.rawToken, 12 * 60 * 60);
  return success(c, { actor: result.actor, csrfToken: result.csrfToken });
});

platformRoutes.use('/stores/*', requireActor('SUPER_ADMIN'));
platformRoutes.use('/stores', requireActor('SUPER_ADMIN'));

platformRoutes.get('/stores', async (c) => {
  const result = await new PlatformService(c.env).listStores();
  return success(c, result.results);
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

export { platformRoutes };
