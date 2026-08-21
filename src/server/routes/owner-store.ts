import { Hono } from 'hono';

import { updatePrintSettingsSchema, updateStoreSettingsSchema } from '@contracts/store';
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

ownerStoreRoutes.get('/print-settings', requirePermission('store.manage'), async (c) =>
  success(c, await new StoreService(c.env).getPrintSettings(c.get('actor').storeId!)),
);

ownerStoreRoutes.put('/print-settings', requirePermission('store.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updatePrintSettingsSchema);
  const storeId = c.get('actor').storeId!;
  const result = await new StoreService(c.env).updatePrintSettings({
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
  return success(c, await new StoreService(c.env).listAuditLogs(c.get('actor').storeId!));
});

export { ownerStoreRoutes };
