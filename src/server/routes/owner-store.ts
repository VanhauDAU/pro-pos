import { Hono } from 'hono';

import {
  bankAccountInputSchema,
  updatePrintSettingsSchema,
  updateStoreSettingsSchema,
} from '@contracts/store';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { StoreService } from '@server/services/store-service';
import type { AppEnv } from '@server/types';

const ownerStoreRoutes = new Hono<AppEnv>();
ownerStoreRoutes.use('*', requireActor('OWNER'));

function storeService(c: Parameters<typeof success>[0]): StoreService {
  return new StoreService(c.env, (promise) => c.executionCtx.waitUntil(promise));
}

ownerStoreRoutes.get('/settings', requirePermission('store.manage'), async (c) =>
  success(c, await storeService(c).getSettings(c.get('actor').storeId!)),
);

ownerStoreRoutes.put('/settings', requirePermission('store.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateStoreSettingsSchema);
  const storeId = c.get('actor').storeId!;
  const result = await storeService(c).updateSettings({
    storeId,
    name: body.name,
    phone: body.phone ?? null,
    address: body.address ?? null,
    cutoff: body.businessDayCutoffMinutes,
    ...(body.employeeRememberSessionHours === undefined
      ? {}
      : { employeeRememberSessionHours: body.employeeRememberSessionHours }),
    bankName: body.bankName ?? null,
    bankAccountNumber: body.bankAccountNumber ?? null,
    bankAccountName: body.bankAccountName ?? null,
    bankQrMediaId: body.bankQrMediaId ?? null,
    provinceCode: body.provinceCode ?? null,
    provinceName: body.provinceName ?? null,
    wardCode: body.wardCode ?? null,
    wardName: body.wardName ?? null,
    auditContext: {
      actorUserId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    },
  });
  return success(c, result);
});

ownerStoreRoutes.post('/bank-accounts', requirePermission('store.manage'), async (c) => {
  const values = await parseJson(c.req.raw, bankAccountInputSchema);
  return success(
    c,
    await storeService(c).createBankAccount({
      storeId: c.get('actor').storeId!,
      values,
      auditContext: {
        actorUserId: c.get('actor').id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    }),
    201,
  );
});

ownerStoreRoutes.patch(
  '/bank-accounts/:bankAccountId',
  requirePermission('store.manage'),
  async (c) => {
    const values = await parseJson(c.req.raw, bankAccountInputSchema);
    return success(
      c,
      await storeService(c).updateBankAccount({
        storeId: c.get('actor').storeId!,
        bankAccountId: c.req.param('bankAccountId'),
        values,
        auditContext: {
          actorUserId: c.get('actor').id,
          actorSessionId: c.get('sessionId'),
          deviceId: c.get('device')?.id ?? null,
          requestId: c.get('requestId'),
        },
      }),
    );
  },
);

ownerStoreRoutes.delete(
  '/bank-accounts/:bankAccountId',
  requirePermission('store.manage'),
  async (c) =>
    success(
      c,
      await storeService(c).archiveBankAccount({
        storeId: c.get('actor').storeId!,
        bankAccountId: c.req.param('bankAccountId'),
        auditContext: {
          actorUserId: c.get('actor').id,
          actorSessionId: c.get('sessionId'),
          deviceId: c.get('device')?.id ?? null,
          requestId: c.get('requestId'),
        },
      }),
    ),
);

ownerStoreRoutes.get('/print-settings', requirePermission('store.manage'), async (c) =>
  success(c, await storeService(c).getPrintSettings(c.get('actor').storeId!)),
);

ownerStoreRoutes.put('/print-settings', requirePermission('store.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updatePrintSettingsSchema);
  const storeId = c.get('actor').storeId!;
  const result = await storeService(c).updatePrintSettings({
    storeId,
    maxReceiptReprintCount: body.maxReceiptReprintCount,
    paymentCopyCount: body.paymentCopyCount,
    allowProvisionalPrint: body.allowProvisionalPrint,
    provisionalCopyCount: body.provisionalCopyCount,
    logoHorizontalLayout: body.logoHorizontalLayout,
    logoMediaId: body.logoMediaId ?? null,
    bottomImageDescription: body.bottomImageDescription ?? null,
    bottomImageType: body.bottomImageType,
    bottomImageMediaId: body.bottomImageMediaId ?? null,
    bottomBankName: body.bottomBankName ?? null,
    bottomBankAccountNumber: body.bottomBankAccountNumber ?? null,
    bottomBankAccountName: body.bottomBankAccountName ?? null,
    customAddressEnabled: body.customAddressEnabled,
    customAddress: body.customAddress ?? null,
    footerLine1: body.footerLine1 ?? null,
    footerLine1Bold: body.footerLine1Bold,
    footerLine2: body.footerLine2 ?? null,
    footerLine2Bold: body.footerLine2Bold,
    printWifiEnabled: body.printWifiEnabled,
    wifiName: body.wifiName ?? null,
    wifiPassword: body.wifiPassword ?? null,
    paperSize: body.paperSize,
    printersJson: body.printersJson ?? null,
    templateConfigJson: body.templateConfigJson ?? null,
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
  return success(c, await storeService(c).listAuditLogs(c.get('actor').storeId!));
});

export { ownerStoreRoutes };
