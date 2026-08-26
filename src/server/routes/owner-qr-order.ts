import { Hono } from 'hono';

import {
  bulkUpdateTableQrStatusSchema,
  updateOwnerQrOrderSettingsSchema,
  updateQrMenuProductSchema,
  updateQrMenuVariantSchema,
  updateQrSalesStatusSchema,
  updateQuickReasonsSchema,
  updateTableQrStatusSchema,
} from '@contracts/owner-qr-order';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { OwnerQrOrderService } from '@server/services/owner-qr-order-service';
import { QrOrderService } from '@server/services/qr-order-service';
import type { AppEnv } from '@server/types';

const ownerQrOrderRoutes = new Hono<AppEnv>();
ownerQrOrderRoutes.use('*', requireActor('OWNER'));

function auditContext(c: Parameters<typeof success>[0]) {
  return {
    actorUserId: c.get('actor').id,
    actorSessionId: c.get('sessionId'),
    deviceId: c.get('device')?.id ?? null,
    requestId: c.get('requestId'),
  };
}

ownerQrOrderRoutes.get('/settings', requirePermission('store.manage'), async (c) =>
  success(c, await new OwnerQrOrderService(c.env).getSettings(c.get('actor').storeId!)),
);

ownerQrOrderRoutes.put('/settings', requirePermission('store.manage'), async (c) => {
  const values = await parseJson(c.req.raw, updateOwnerQrOrderSettingsSchema);
  return success(
    c,
    await new OwnerQrOrderService(c.env).updateSettings({
      storeId: c.get('actor').storeId!,
      values,
      auditContext: auditContext(c),
    }),
  );
});

ownerQrOrderRoutes.patch('/sales-status', requirePermission('store.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateQrSalesStatusSchema);
  return success(
    c,
    await new OwnerQrOrderService(c.env).setSalesPaused({
      storeId: c.get('actor').storeId!,
      paused: body.paused,
      auditContext: auditContext(c),
    }),
  );
});

ownerQrOrderRoutes.get('/tables', requirePermission('table.manage'), async (c) =>
  success(c, await new OwnerQrOrderService(c.env).listTables(c.get('actor').storeId!)),
);

ownerQrOrderRoutes.patch('/tables/bulk', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, bulkUpdateTableQrStatusSchema);
  return success(
    c,
    await new OwnerQrOrderService(c.env).setTablesEnabled({
      storeId: c.get('actor').storeId!,
      tableIds: body.tableIds,
      enabled: body.enabled,
      auditContext: auditContext(c),
    }),
  );
});

ownerQrOrderRoutes.patch('/tables/:tableId', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateTableQrStatusSchema);
  return success(
    c,
    await new OwnerQrOrderService(c.env).setTableEnabled({
      storeId: c.get('actor').storeId!,
      tableId: c.req.param('tableId'),
      enabled: body.enabled,
      auditContext: auditContext(c),
    }),
  );
});

ownerQrOrderRoutes.get('/tables/:tableId/qr-code', requirePermission('table.manage'), async (c) =>
  success(
    c,
    await new QrOrderService(c.env).getOrCreateQrCode(
      c.get('actor').storeId!,
      c.req.param('tableId'),
      c.get('actor').id,
    ),
  ),
);

ownerQrOrderRoutes.get('/menu', requirePermission('store.manage'), async (c) =>
  success(c, await new OwnerQrOrderService(c.env).listMenu(c.get('actor').storeId!)),
);

ownerQrOrderRoutes.patch(
  '/menu/products/:productId',
  requirePermission('store.manage'),
  async (c) => {
    const body = await parseJson(c.req.raw, updateQrMenuProductSchema);
    return success(
      c,
      await new OwnerQrOrderService(c.env).setMenuProductEnabled({
        storeId: c.get('actor').storeId!,
        productId: c.req.param('productId'),
        enabled: body.enabled,
        auditContext: auditContext(c),
      }),
    );
  },
);

ownerQrOrderRoutes.patch(
  '/menu/variants/:variantId',
  requirePermission('store.manage'),
  async (c) => {
    const body = await parseJson(c.req.raw, updateQrMenuVariantSchema);
    return success(
      c,
      await new OwnerQrOrderService(c.env).setMenuVariantEnabled({
        storeId: c.get('actor').storeId!,
        variantId: c.req.param('variantId'),
        enabled: body.enabled,
        auditContext: auditContext(c),
      }),
    );
  },
);

ownerQrOrderRoutes.get('/quick-reasons', requirePermission('store.manage'), async (c) =>
  success(c, await new OwnerQrOrderService(c.env).listQuickReasons(c.get('actor').storeId!)),
);

ownerQrOrderRoutes.put('/quick-reasons', requirePermission('store.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateQuickReasonsSchema);
  return success(
    c,
    await new OwnerQrOrderService(c.env).replaceQuickReasons({
      storeId: c.get('actor').storeId!,
      reasons: body.reasons,
      auditContext: auditContext(c),
    }),
  );
});

export { ownerQrOrderRoutes };
