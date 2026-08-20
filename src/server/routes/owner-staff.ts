import { Hono } from 'hono';
import { z } from 'zod';

import { resetPinSchema } from '@contracts/auth';
import { createEmployeeSchema } from '@contracts/platform';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { StaffService } from '@server/services/staff-service';
import type { AppEnv } from '@server/types';

const ownerStaffRoutes = new Hono<AppEnv>();

ownerStaffRoutes.use('*', requireActor('OWNER'));
ownerStaffRoutes.use('*', requirePermission('staff.manage'));

ownerStaffRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  return success(c, await new StaffService(c.env).listEmployees(actor.storeId!));
});

ownerStaffRoutes.post('/', async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, createEmployeeSchema);
  return success(
    c,
    await new StaffService(c.env).createEmployee({
      storeId: actor.storeId!,
      ...body,
      auditContext: {
        actorUserId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    }),
    201,
  );
});

ownerStaffRoutes.patch('/:userId/status', async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }));
  return success(
    c,
    await new StaffService(c.env).setEmployeeStatus(
      actor.storeId!,
      c.req.param('userId'),
      body.status,
      {
        actorUserId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    ),
  );
});

ownerStaffRoutes.put('/:userId/pin', async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, resetPinSchema);
  return success(
    c,
    await new StaffService(c.env).resetPin(actor.storeId!, c.req.param('userId'), body.pin, {
      actorUserId: actor.id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  );
});

export { ownerStaffRoutes };
