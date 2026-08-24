import { Hono } from 'hono';
import { z } from 'zod';

import { resetPinSchema } from '@contracts/auth';
import {
  createEmployeeSchema,
  createRoleSchema,
  employeeBulkActionSchema,
  updateEmployeeSchema,
  updateRoleSchema,
} from '@contracts/staff';
import { rolePermissionCatalog } from '@contracts/staff';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { StaffService } from '@server/services/staff-service';
import type { AppEnv } from '@server/types';

const ownerStaffRoutes = new Hono<AppEnv>();

const permissionCatalogResponse = rolePermissionCatalog.map((group) => ({
  key: group.key,
  title: group.title,
  description: group.description,
  sections: group.sections.map((section) => ({
    key: section.key,
    title: section.title,
    description: section.description,
    permissions: section.permissions.map(([key, label]) => ({ key, label })),
  })),
}));

ownerStaffRoutes.use('*', requireActor('OWNER'));
ownerStaffRoutes.use('*', requirePermission('staff.manage'));

function auditContext(c: Parameters<typeof success>[0]) {
  return {
    actorUserId: c.get('actor').id,
    actorSessionId: c.get('sessionId'),
    deviceId: c.get('device')?.id ?? null,
    requestId: c.get('requestId'),
  };
}

ownerStaffRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  return success(c, await new StaffService(c.env).listEmployees(actor.storeId!));
});

ownerStaffRoutes.get('/roles/permissions', async (c) => success(c, permissionCatalogResponse));

ownerStaffRoutes.get('/roles', async (c) =>
  success(c, await new StaffService(c.env).listRoles(c.get('actor').storeId!)),
);

ownerStaffRoutes.post('/roles', async (c) => {
  const body = await parseJson(c.req.raw, createRoleSchema);
  return success(
    c,
    await new StaffService(c.env).createRole(
      c.get('actor').storeId!,
      body.name,
      body.permissionKeys,
      auditContext(c),
    ),
    201,
  );
});

ownerStaffRoutes.get('/roles/:roleId', async (c) =>
  success(c, await new StaffService(c.env).getRole(c.get('actor').storeId!, c.req.param('roleId'))),
);

ownerStaffRoutes.put('/roles/:roleId', async (c) => {
  const body = await parseJson(c.req.raw, updateRoleSchema);
  return success(
    c,
    await new StaffService(c.env).updateRole(
      c.get('actor').storeId!,
      c.req.param('roleId'),
      body.name,
      body.permissionKeys,
      auditContext(c),
    ),
  );
});

ownerStaffRoutes.delete('/roles/:roleId', async (c) =>
  success(
    c,
    await new StaffService(c.env).deleteRole(
      c.get('actor').storeId!,
      c.req.param('roleId'),
      auditContext(c),
    ),
  ),
);

ownerStaffRoutes.post('/', async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, createEmployeeSchema);
  return success(
    c,
    await new StaffService(c.env).createEmployee({
      storeId: actor.storeId!,
      displayName: body.displayName,
      username: body.username,
      pin: body.pin,
      email: body.email ?? null,
      permissionKeys: body.permissionKeys,
      ...(body.roleId ? { roleId: body.roleId } : {}),
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

ownerStaffRoutes.post('/bulk-action', async (c) => {
  const body = await parseJson(c.req.raw, employeeBulkActionSchema);
  return success(
    c,
    await new StaffService(c.env).bulkAction(
      c.get('actor').storeId!,
      body.userIds,
      body.action,
      auditContext(c),
    ),
  );
});

ownerStaffRoutes.get('/:userId', async (c) =>
  success(
    c,
    await new StaffService(c.env).getEmployee(c.get('actor').storeId!, c.req.param('userId')),
  ),
);

ownerStaffRoutes.put('/:userId', async (c) => {
  const body = await parseJson(c.req.raw, updateEmployeeSchema);
  return success(
    c,
    await new StaffService(c.env).updateEmployee(
      c.get('actor').storeId!,
      c.req.param('userId'),
      body,
      auditContext(c),
    ),
  );
});

ownerStaffRoutes.delete('/:userId', async (c) =>
  success(
    c,
    await new StaffService(c.env).deleteEmployee(
      c.get('actor').storeId!,
      c.req.param('userId'),
      auditContext(c),
    ),
  ),
);

ownerStaffRoutes.post('/:userId/sessions/revoke', async (c) => {
  const storeId = c.get('actor').storeId!;
  const result = await new StaffService(c.env).terminateSessions(
    storeId,
    c.req.param('userId'),
    auditContext(c),
  );
  const room = c.env.STORE_REALTIME.getByName(storeId);
  for (const sessionId of result.sessionIds) {
    c.executionCtx.waitUntil(room.disconnectSession(storeId, sessionId).catch(() => 0));
  }
  return success(c, result);
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
