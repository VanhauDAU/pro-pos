import { Hono } from 'hono';

import { updateStoreSettingsSchema } from '@contracts/store';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { StoreService } from '@server/services/store-service';
import type { AppEnv } from '@server/types';

const ownerStoreRoutes = new Hono<AppEnv>();
ownerStoreRoutes.use('*', requireActor('OWNER'));

ownerStoreRoutes.get('/settings', requirePermission('store.manage'), async (c) =>
  success(c, await new StoreService(c.env).getSettings(c.get('actor').storeId!)),
);

ownerStoreRoutes.put('/settings', requirePermission('store.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateStoreSettingsSchema);
  const storeId = c.get('actor').storeId!;
  const result = await new StoreService(c.env).updateSettings({
    storeId,
    name: body.name,
    phone: body.phone ?? null,
    address: body.address ?? null,
    cutoff: body.businessDayCutoffMinutes,
    bankName: body.bankName ?? null,
    bankAccountNumber: body.bankAccountNumber ?? null,
    bankAccountName: body.bankAccountName ?? null,
    bankQrMediaId: body.bankQrMediaId ?? null,
    auditContext: {
      actorUserId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    },
  });
  return success(c, result);
});

ownerStoreRoutes.get('/audit-logs', requirePermission('audit.view'), async (c) => {
  return success(c, await new StoreService(c.env).listAuditLogs(c.get('actor').storeId!));
});

export { ownerStoreRoutes };
