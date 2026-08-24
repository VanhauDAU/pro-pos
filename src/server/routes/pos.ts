import { Hono } from 'hono';

import { REALTIME_SUBPROTOCOL } from '@contracts/realtime';
import { updatePrinterDeviceSettingsSchema } from '@contracts/store';
import {
  addOrderItemSchema,
  cancelOrderSchema,
  checkoutSchema,
  createTakeawayOrderSchema,
  openTableSchema,
  removeOrderItemSchema,
  removeTimeSessionSchema,
  resumeCheckoutSchema,
  stopTimeSchema,
  timeActionSchema,
  updateTimeRangeSchema,
  transferTableSchema,
  updateOrderItemSchema,
  updateOrderNoteSchema,
  updateOrderGuestSchema,
  openOrderCommandSchema,
  saveExistingOrderCommandSchema,
} from '@contracts/pos';
import { applyPromotionSchema, promotionPreviewSchema } from '@contracts/promotion';
import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import {
  assertPermission,
  requireActor,
  requirePermission,
} from '@server/middleware/authorization';
import { PosService } from '@server/services/pos-service';
import { StoreService } from '@server/services/store-service';
import { CustomerService } from '@server/services/customer-service';
import { PromotionService } from '@server/services/promotion-service';
import {
  customerGroupInputSchema,
  customerImportSchema,
  customerInputSchema,
  debtAdjustmentSchema,
  debtPaymentSchema,
  loyaltySettingsSchema,
} from '@contracts/customer';
import { z } from 'zod';
import { StaffService } from '@server/services/staff-service';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  employeeBulkActionSchema,
} from '@contracts/staff';
import { OwnerInvoiceService } from '@server/services/owner-invoice-service';
import { RealtimeRepository } from '@server/repositories/realtime-repository';
import { RealtimeDispatcher } from '@server/realtime/realtime-dispatcher';
import { qrOrderStaffRoutes } from '@server/routes/qr-order-staff';
import { QrOrderService } from '@server/services/qr-order-service';
import { pushNotificationRoutes } from '@server/routes/push-notifications';
import type { AppEnv } from '@server/types';
import { measureRequestTiming } from '@server/lib/performance';

const posRoutes = new Hono<AppEnv>();
posRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));

function producesRealtimeEvent(path: string) {
  return (
    path.includes('/api/v1/pos/orders/') ||
    path.endsWith('/api/v1/pos/orders/open') ||
    path.endsWith('/api/v1/pos/tables/open') ||
    path.includes('/api/v1/pos/qr-orders/')
  );
}

posRoutes.use('*', async (c, next) => {
  await next();
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) &&
    !c.req.path.endsWith('/promotions/preview') &&
    producesRealtimeEvent(c.req.path) &&
    c.res.status >= 200 &&
    c.res.status < 300
  ) {
    const storeId = c.get('actor').storeId;
    if (storeId) {
      c.executionCtx.waitUntil(
        new RealtimeDispatcher(c.env).dispatchStore(storeId).catch(() => undefined),
      );
    }
  }
});

function idempotencyKey(c: Parameters<typeof success>[0]) {
  const value = c.req.header('Idempotency-Key');
  if (!value || value.length < 8 || value.length > 128) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Thiếu Idempotency-Key hợp lệ.', 422);
  }
  return value;
}

posRoutes.get('/tables', requirePermission('table.view'), async (c) =>
  success(c, await new PosService(c.env).listTables(c.get('actor').storeId!)),
);

posRoutes.get('/context', async (c) => {
  const actor = c.get('actor');
  return success(c, await new PosService(c.env).getStaffContext(actor.storeId!, actor.id));
});

posRoutes.get('/realtime/sync', requirePermission('table.view'), async (c) => {
  const storeId = c.get('actor').storeId!;
  const repository = new RealtimeRepository(c.env.DB);
  if (!(await repository.isEnabled(storeId))) {
    throw new AppError('REALTIME_DISABLED', 'Realtime chưa được bật cho cửa hàng này.', 409);
  }
  const rawAfter = c.req.query('after');
  let after: number | null = null;
  if (rawAfter !== undefined) {
    after = Number(rawAfter);
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new AppError('REALTIME_CURSOR_INVALID', 'Realtime cursor không hợp lệ.', 422);
    }
  }
  return success(c, await repository.sync(storeId, after));
});

posRoutes.get('/realtime/stream', requirePermission('table.view'), async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new AppError('WEBSOCKET_UPGRADE_REQUIRED', 'Yêu cầu WebSocket upgrade.', 422);
  }
  const protocols = (c.req.header('Sec-WebSocket-Protocol') ?? '')
    .split(',')
    .map((item) => item.trim());
  if (!protocols.includes(REALTIME_SUBPROTOCOL)) {
    throw new AppError(
      'REALTIME_PROTOCOL_UNSUPPORTED',
      'Realtime protocol không được hỗ trợ.',
      422,
    );
  }
  const actor = c.get('actor');
  const storeId = actor.storeId!;
  const repository = new RealtimeRepository(c.env.DB);
  if (!(await repository.isEnabled(storeId))) {
    throw new AppError('REALTIME_DISABLED', 'Realtime chưa được bật cho cửa hàng này.', 409);
  }

  const connectionId = crypto.randomUUID();
  const reauthAt = Date.now() + 5 * 60_000;
  const headers = new Headers(c.req.raw.headers);
  headers.set('Upgrade', 'websocket');
  headers.set('Sec-WebSocket-Protocol', REALTIME_SUBPROTOCOL);
  headers.set('X-Propos-Realtime-Store', storeId);
  headers.set('X-Propos-Realtime-User', actor.id);
  headers.set('X-Propos-Realtime-Session', c.get('sessionId'));
  headers.set('X-Propos-Realtime-Connection', connectionId);
  headers.set('X-Propos-Realtime-Reauth-At', String(reauthAt));
  headers.set(
    'X-Propos-Realtime-Client-Version',
    (c.req.query('clientVersion') ?? 'unknown').slice(0, 100),
  );
  const deviceId = c.get('device')?.id;
  if (deviceId) headers.set('X-Propos-Realtime-Device', deviceId);

  const room = c.env.STORE_REALTIME.getByName(storeId);
  return room.fetch(new Request(c.req.url, { method: 'GET', headers }));
});

posRoutes.get('/print-settings', requirePermission('order.manage'), async (c) =>
  success(c, await new StoreService(c.env).getPrintSettings(c.get('actor').storeId!)),
);

posRoutes.get(
  '/customers',
  requirePermission('customer.list.view', 'order.add_customer'),
  async (c) => {
    const page = Math.max(1, Number(c.req.query('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)));
    const search = c.req.query('search')?.trim();
    const status = c.req.query('status');
    return success(
      c,
      await new CustomerService(c.env).list(c.get('actor').storeId!, {
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page,
        limit,
      }),
    );
  },
);

posRoutes.get(
  '/customers/loyalty-settings',
  requirePermission('customer.list.view', 'customer.list.create'),
  async (c) =>
    success(c, await new CustomerService(c.env).loyaltySettings(c.get('actor').storeId!)),
);

posRoutes.put(
  '/customers/loyalty-settings',
  requirePermission('customer.list.edit_debt'),
  async (c) => {
    const body = await parseJson(c.req.raw, loyaltySettingsSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new CustomerService(c.env).saveLoyaltySettings(
        actor.storeId!,
        actor.id,
        body.enabled,
        body.vndPerPoint,
      ),
    );
  },
);

posRoutes.get(
  '/customers/groups',
  requirePermission('customer.groups.view', 'customer.list.view'),
  async (c) => success(c, await new CustomerService(c.env).listGroups(c.get('actor').storeId!)),
);

posRoutes.post(
  '/customers/import/validate',
  requirePermission('customer.list.import_export'),
  async (c) => {
    const body = await parseJson(c.req.raw, customerImportSchema);
    return success(
      c,
      await new CustomerService(c.env).validateImport(c.get('actor').storeId!, body.rows),
    );
  },
);

posRoutes.post('/customers/import', requirePermission('customer.list.import_export'), async (c) => {
  const body = await parseJson(c.req.raw, customerImportSchema);
  const actor = c.get('actor');
  return success(c, await new CustomerService(c.env).import(actor.storeId!, actor.id, body.rows));
});

posRoutes.post('/customers/groups', requirePermission('customer.groups.create'), async (c) => {
  const body = await parseJson(c.req.raw, customerGroupInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).saveGroup(actor.storeId!, actor.id, body),
    201,
  );
});

posRoutes.get('/customers/groups/:id', requirePermission('customer.groups.view'), async (c) =>
  success(
    c,
    await new CustomerService(c.env).groupDetail(c.get('actor').storeId!, c.req.param('id')),
  ),
);

posRoutes.put('/customers/groups/:id', requirePermission('customer.groups.edit'), async (c) => {
  const body = await parseJson(c.req.raw, customerGroupInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).saveGroup(actor.storeId!, actor.id, body, c.req.param('id')),
  );
});

posRoutes.delete('/customers/groups/:id', requirePermission('customer.groups.delete'), async (c) =>
  success(
    c,
    await new CustomerService(c.env).deleteGroup(c.get('actor').storeId!, c.req.param('id')),
  ),
);

posRoutes.post(
  '/customers',
  requirePermission('customer.list.create', 'order.add_customer'),
  async (c) => {
    const body = await parseJson(c.req.raw, customerInputSchema);
    const actor = c.get('actor');
    return success(c, await new CustomerService(c.env).create(actor.storeId!, actor.id, body), 201);
  },
);

posRoutes.get(
  '/customers/:id',
  requirePermission('customer.list.view', 'order.add_customer'),
  async (c) =>
    success(c, await new CustomerService(c.env).detail(c.get('actor').storeId!, c.req.param('id'))),
);

posRoutes.put('/customers/:id', requirePermission('customer.list.edit_debt'), async (c) => {
  const body = await parseJson(c.req.raw, customerInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).update(actor.storeId!, c.req.param('id'), body),
  );
});

posRoutes.delete('/customers/:id', requirePermission('customer.list.delete'), async (c) =>
  success(c, await new CustomerService(c.env).archive(c.get('actor').storeId!, c.req.param('id'))),
);

posRoutes.post(
  '/customers/:id/debt-payments',
  requirePermission('customer.list.edit_debt', 'checkout.complete'),
  async (c) => {
    const body = await parseJson(c.req.raw, debtPaymentSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new CustomerService(c.env).payDebt(actor.storeId!, c.req.param('id'), actor.id, body),
    );
  },
);

posRoutes.post(
  '/customers/:id/debt-adjustments',
  requirePermission('customer.list.edit_debt'),
  async (c) => {
    const body = await parseJson(c.req.raw, debtAdjustmentSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new CustomerService(c.env).adjustDebt(
        actor.storeId!,
        c.req.param('id'),
        actor.id,
        body,
      ),
    );
  },
);

// ── Staff & Employee Management ──────────────────────────────────────────────
posRoutes.get('/staff', requirePermission('staff.employees.view'), async (c) => {
  const actor = c.get('actor');
  return success(c, await new StaffService(c.env).listEmployees(actor.storeId!));
});

posRoutes.get(
  '/staff/roles',
  requirePermission('staff.employees.view', 'staff.employees.create', 'staff.employees.edit'),
  async (c) => success(c, await new StaffService(c.env).listRoles(c.get('actor').storeId!)),
);

posRoutes.post('/staff', requirePermission('staff.employees.create'), async (c) => {
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

posRoutes.post(
  '/staff/bulk-action',
  requirePermission('staff.employees.edit', 'staff.employees.delete'),
  async (c) => {
    const body = await parseJson(c.req.raw, employeeBulkActionSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new StaffService(c.env).bulkAction(actor.storeId!, body.userIds, body.action, {
        actorUserId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      }),
    );
  },
);

posRoutes.get('/staff/:userId', requirePermission('staff.employees.view'), async (c) =>
  success(
    c,
    await new StaffService(c.env).getEmployee(c.get('actor').storeId!, c.req.param('userId')),
  ),
);

posRoutes.put('/staff/:userId', requirePermission('staff.employees.edit'), async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, updateEmployeeSchema);
  return success(
    c,
    await new StaffService(c.env).updateEmployee(actor.storeId!, c.req.param('userId'), body, {
      actorUserId: actor.id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  );
});

posRoutes.delete('/staff/:userId', requirePermission('staff.employees.delete'), async (c) => {
  const actor = c.get('actor');
  return success(
    c,
    await new StaffService(c.env).deleteEmployee(actor.storeId!, c.req.param('userId'), {
      actorUserId: actor.id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  );
});

posRoutes.post(
  '/staff/:userId/sessions/revoke',
  requirePermission('staff.employees.edit'),
  async (c) => {
    const actor = c.get('actor');
    const result = await new StaffService(c.env).terminateSessions(
      actor.storeId!,
      c.req.param('userId'),
      {
        actorUserId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    );
    const room = c.env.STORE_REALTIME.getByName(actor.storeId!);
    for (const sessionId of result.sessionIds) {
      c.executionCtx.waitUntil(room.disconnectSession(actor.storeId!, sessionId).catch(() => 0));
    }
    return success(c, result);
  },
);

posRoutes.patch('/staff/:userId/status', requirePermission('staff.employees.edit'), async (c) => {
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

posRoutes.put('/staff/:userId/pin', requirePermission('staff.employees.edit'), async (c) => {
  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, z.object({ pin: z.string().regex(/^\d{4}$/) }));
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

posRoutes.put('/printer-settings', requirePermission('order.manage'), async (c) => {
  const printer = await parseJson(c.req.raw, updatePrinterDeviceSettingsSchema);
  const actor = c.get('actor');
  const storeId = actor.storeId!;
  const service = new StoreService(c.env);
  const current = await service.getPrintSettings(storeId);

  await service.updatePrintSettings({
    ...current,
    storeId,
    paperSize: printer.paperSize,
    printersJson: JSON.stringify(printer),
    auditContext: {
      actorUserId: actor.id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    },
  });

  return success(c, await service.getPrintSettings(storeId));
});

posRoutes.get('/catalog', requirePermission('order.manage'), async (c) =>
  success(c, await new PosService(c.env).listCatalog(c.get('actor').storeId!)),
);

posRoutes.get('/orders', requirePermission('table.view'), async (c) =>
  success(c, await new PosService(c.env).listOrders(c.get('actor').storeId!)),
);

posRoutes.get('/overview', requirePermission('table.view'), async (c) =>
  success(
    c,
    await measureRequestTiming(c, 'overview', () =>
      new PosService(c.env).overview(c.get('actor').storeId!),
    ),
  ),
);

posRoutes.post('/orders/open', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, openOrderCommandSchema);
  if (body.items.some((item) => Boolean(item.discount))) {
    await assertPermission(c, 'discount.apply');
  }
  if (body.promotionIds !== undefined) await assertPermission(c, 'promotion.apply');
  const actor = c.get('actor');
  return success(
    c,
    await measureRequestTiming(c, 'command', () =>
      new PosService(c.env).openOrderCommand({
        storeId: actor.storeId!,
        actorId: actor.id,
        requestId: c.get('requestId'),
        idempotencyKey: idempotencyKey(c),
        values: body,
      }),
    ),
    201,
  );
});

posRoutes.post('/orders/:orderId/save', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, saveExistingOrderCommandSchema);
  if (
    body.addedItems.some((item) => Boolean(item.discount)) ||
    body.updatedItems.some((item) => Boolean(item.discount))
  ) {
    await assertPermission(c, 'discount.apply');
  }
  if (body.promotionIds !== undefined) await assertPermission(c, 'promotion.apply');
  const actor = c.get('actor');
  return success(
    c,
    await measureRequestTiming(c, 'command', () =>
      new PosService(c.env).saveOrderCommand({
        storeId: actor.storeId!,
        actorId: actor.id,
        requestId: c.get('requestId'),
        idempotencyKey: idempotencyKey(c),
        orderId: c.req.param('orderId'),
        values: body,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
      }),
    ),
  );
});

posRoutes.get('/orders/:orderId/call-batches', requirePermission('order.manage'), async (c) => {
  const actor = c.get('actor');
  const rawBeforeSequence = c.req.query('beforeSequence');
  const rawLimit = c.req.query('limit');
  const beforeSequence = rawBeforeSequence ? Number(rawBeforeSequence) : undefined;
  const limit = rawLimit ? Number(rawLimit) : 20;
  if (
    (beforeSequence !== undefined && (!Number.isInteger(beforeSequence) || beforeSequence <= 0)) ||
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new AppError('VALIDATION_ERROR', 'Tham số lịch sử gọi món không hợp lệ.', 422);
  }
  return success(
    c,
    await new PosService(c.env).listOrderCallBatches(
      actor.storeId!,
      c.req.param('orderId'),
      beforeSequence,
      limit,
    ),
  );
});

posRoutes.post('/orders', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, createTakeawayOrderSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).createTakeaway({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      note: body.note ?? null,
    }),
    201,
  );
});

posRoutes.post('/tables/open', requirePermission('table.open'), async (c) => {
  const body = await parseJson(c.req.raw, openTableSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).openTable({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      tableId: body.tableId,
      expectedTableVersion: body.expectedTableVersion,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
    201,
  );
});

posRoutes.post('/tables/:tableId/qr-code', requirePermission('table.view'), async (c) =>
  success(
    c,
    await new QrOrderService(c.env).rotateQrCode(
      c.get('actor').storeId!,
      c.req.param('tableId'),
      c.get('actor').id,
    ),
    201,
  ),
);

posRoutes.get('/orders/:orderId/quote', requirePermission('table.view'), async (c) =>
  success(c, await new PosService(c.env).quote(c.get('actor').storeId!, c.req.param('orderId'))),
);

posRoutes.get('/orders/:orderId/detail', requirePermission('table.view'), async (c) =>
  success(
    c,
    await new PosService(c.env).getOrderDetail(c.get('actor').storeId!, c.req.param('orderId')),
  ),
);

posRoutes.post('/promotions/preview', requirePermission('promotion.apply'), async (c) => {
  const body = await parseJson(c.req.raw, promotionPreviewSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PromotionService(c.env).previewForOrder({
      storeId: actor.storeId!,
      orderId: body.orderId ?? null,
      customerId: body.customerId ?? null,
      subtotalVnd: body.subtotalVnd,
      promotionIds: body.promotionIds,
      items: body.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        productType: item.productType ?? 'QUANTITY',
        productName: item.productName ?? '',
        variantName: item.variantName ?? null,
        unitPriceVnd: item.unitPriceVnd,
        quantityMilli: item.quantityMilli,
        grossLineTotalVnd: item.grossLineTotalVnd,
        netLineTotalVnd: item.netLineTotalVnd,
      })),
    }),
  );
});

posRoutes.get('/orders/:orderId/promotions', requirePermission('promotion.apply'), async (c) => {
  const quote = await new PosService(c.env).quote(c.get('actor').storeId!, c.req.param('orderId'));
  return success(c, { applied: quote.promotions, options: quote.promotionOptions });
});

posRoutes.put('/orders/:orderId/promotion', requirePermission('promotion.apply'), async (c) => {
  const body = await parseJson(c.req.raw, applyPromotionSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).applyPromotion({
      storeId: actor.storeId!,
      orderId: c.req.param('orderId'),
      promotionIds: body.promotionIds,
      expectedOrderVersion: body.expectedOrderVersion,
      actorId: actor.id,
    }),
  );
});

posRoutes.post('/orders/:orderId/items', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, addOrderItemSchema);
  const actor = c.get('actor');
  if (body.discount) await assertPermission(c, 'discount.apply');
  return success(
    c,
    await new PosService(c.env).addItem({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      productId: body.productId,
      variantId: body.variantId ?? null,
      ...(body.enteredUnitPriceVnd === undefined
        ? {}
        : { enteredUnitPriceVnd: body.enteredUnitPriceVnd }),
      quantityMilli: body.quantityMilli,
      timeStartedAtMs: body.timeStartedAtMs,
      timeEndedAtMs: body.timeEndedAtMs,
      note: body.note ?? null,
      expectedOrderVersion: body.expectedOrderVersion,
      discount: body.discount ?? null,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
    201,
  );
});

posRoutes.patch('/orders/:orderId/items/:itemId', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateOrderItemSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).updateItem({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      itemId: c.req.param('itemId'),
      expectedOrderVersion: body.expectedOrderVersion,
      quantityMilli: body.quantityMilli,
      variantId: body.variantId,
      discount: body.discount,
      timeStartedAtMs: body.timeStartedAtMs,
      timeEndedAtMs: body.timeEndedAtMs,
      note: body.note ?? null,
    }),
  );
});

posRoutes.delete('/orders/:orderId/items/:itemId', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, removeOrderItemSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).removeItem({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      itemId: c.req.param('itemId'),
      expectedOrderVersion: body.expectedOrderVersion,
      reason: body.reason,
    }),
  );
});

posRoutes.delete('/orders/:orderId/time', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, removeTimeSessionSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).removeTimeSession({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      reason: body.reason,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
  );
});

posRoutes.patch('/orders/:orderId/note', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateOrderNoteSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).updateNote({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      note: body.note,
    }),
  );
});

posRoutes.patch('/orders/:orderId/guest', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateOrderGuestSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).updateGuest({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      guestCount: body.guestCount,
      customerName: body.customerName ?? null,
      customerPhone: body.customerPhone ?? null,
      customerId: body.customerId ?? null,
    }),
  );
});

posRoutes.post('/orders/:orderId/time/pause', requirePermission('time.pause'), async (c) => {
  const body = await parseJson(c.req.raw, timeActionSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).pause({
      storeId: actor.storeId!,
      actorId: actor.id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
    }),
  );
});

posRoutes.post('/orders/:orderId/time/resume', requirePermission('time.pause'), async (c) => {
  const body = await parseJson(c.req.raw, timeActionSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).resume({
      storeId: actor.storeId!,
      actorId: actor.id,
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
    }),
  );
});

posRoutes.patch('/orders/:orderId/time/range', requirePermission('time.pause'), async (c) => {
  const body = await parseJson(c.req.raw, updateTimeRangeSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).updateTimeRange({
      storeId: actor.storeId!,
      actorId: actor.id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      startedAtMs: body.startedAtMs,
      endedAtMs: body.endedAtMs,
    }),
  );
});

posRoutes.post('/orders/:orderId/stop-time', requirePermission('checkout.complete'), async (c) => {
  const body = await parseJson(c.req.raw, stopTimeSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).stopTimeForCheckout({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
  );
});

posRoutes.post(
  '/orders/:orderId/resume-checkout',
  requirePermission('checkout.complete'),
  async (c) => {
    const body = await parseJson(c.req.raw, resumeCheckoutSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new PosService(c.env).resumeCheckout({
        storeId: actor.storeId!,
        actorId: actor.id,
        requestId: c.get('requestId'),
        idempotencyKey: idempotencyKey(c),
        orderId: c.req.param('orderId'),
        expectedOrderVersion: body.expectedOrderVersion,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
      }),
    );
  },
);

posRoutes.post('/orders/:orderId/checkout', requirePermission('checkout.complete'), async (c) => {
  const body = await parseJson(c.req.raw, checkoutSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).checkout({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      paymentSnapshotId: body.paymentSnapshotId ?? null,
      method: body.method,
      cashReceivedVnd: body.cashReceivedVnd ?? null,
      allocations: body.allocations ?? [],
      debtAmountVnd: body.debtAmountVnd,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
  );
});

posRoutes.post('/orders/:orderId/transfer', requirePermission('table.transfer'), async (c) => {
  const body = await parseJson(c.req.raw, transferTableSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).transfer({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      targetTableId: body.targetTableId,
      expectedOrderVersion: body.expectedOrderVersion,
      expectedSourceTableVersion: body.expectedSourceTableVersion,
      expectedTargetTableVersion: body.expectedTargetTableVersion,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
  );
});

posRoutes.post('/orders/:orderId/cancel', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, cancelOrderSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PosService(c.env).cancel({
      storeId: actor.storeId!,
      actorId: actor.id,
      requestId: c.get('requestId'),
      idempotencyKey: idempotencyKey(c),
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
      reason: body.reason,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
    }),
  );
});

posRoutes.get('/invoices', requirePermission('invoice.view'), async (c) => {
  const storeId = c.get('actor').storeId!;
  const qs = c.req.query();

  const rawStatus = qs['status'];
  const status: 'PAID' | 'CANCELLED' | undefined =
    rawStatus === 'PAID' || rawStatus === 'CANCELLED' ? rawStatus : undefined;

  const rawOrderType = qs['orderType'];
  const orderType: 'DINE_IN' | 'TAKEAWAY' | undefined =
    rawOrderType === 'DINE_IN' || rawOrderType === 'TAKEAWAY' ? rawOrderType : undefined;

  const rawMethod = qs['method'];
  const method: 'CASH' | 'BANK_TRANSFER' | undefined =
    rawMethod === 'CASH' || rawMethod === 'BANK_TRANSFER' ? rawMethod : undefined;

  const search = qs['search']?.trim() ?? '';
  const dateFrom = qs['dateFrom'] ?? null;
  const dateTo = qs['dateTo'] ?? null;
  const page = Math.max(1, Number(qs['page'] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(qs['limit'] ?? 20)));

  const result = await new OwnerInvoiceService(c.env).listInvoices({
    storeId,
    status,
    search,
    orderType,
    method,
    dateFrom,
    dateTo,
    page,
    limit,
  });
  return success(c, result);
});

posRoutes.get('/invoices/:invoiceId', requirePermission('invoice.view'), async (c) =>
  success(
    c,
    await new PosService(c.env).getInvoice(c.get('actor').storeId!, c.req.param('invoiceId')),
  ),
);

posRoutes.delete('/invoices/:id', requirePermission('invoice.delete'), async (c) => {
  const storeId = c.get('actor').storeId!;
  const id = c.req.param('id');
  const actor = c.get('actor');
  const requestId = c.get('requestId') || 'req-delete-invoice';

  const result = await new OwnerInvoiceService(c.env).deleteInvoice({
    storeId,
    targetId: id,
    actorUserId: actor.id,
    requestId,
  });

  c.executionCtx.waitUntil(
    new RealtimeDispatcher(c.env).dispatchStore(storeId).catch(() => undefined),
  );

  return success(c, result);
});

posRoutes.route('/qr-orders', qrOrderStaffRoutes);
posRoutes.route('/push', pushNotificationRoutes);

export { posRoutes };
