import { Hono } from 'hono';

import { changePasswordSchema } from '@contracts/auth';
import { updateStoreSettingsSchema } from '@contracts/store';
import { clearCredentialCookie } from '@server/lib/cookies';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { AuthService } from '@server/services/auth-service';
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
  });
  return success(c, result);
});

ownerStoreRoutes.get('/audit-logs', requirePermission('audit.view'), async (c) => {
  return success(c, await new StoreService(c.env).listAuditLogs(c.get('actor').storeId!));
});

ownerStoreRoutes.put('/account/password', async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, changePasswordSchema);
  const result = await new AuthService(c.env).changeOwnerPassword({
    userId: actor.id,
    storeId: actor.storeId!,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });
  clearCredentialCookie(c, 'session');
  return success(c, result);
});

export { ownerStoreRoutes };
