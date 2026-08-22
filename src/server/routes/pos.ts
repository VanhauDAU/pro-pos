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
} from '@contracts/pos';
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
import { customerInputSchema, debtPaymentSchema } from '@contracts/customer';
import { OwnerInvoiceService } from '@server/services/owner-invoice-service';
import { RealtimeRepository } from '@server/repositories/realtime-repository';
import { RealtimeDispatcher } from '@server/realtime/realtime-dispatcher';
import { qrOrderStaffRoutes } from '@server/routes/qr-order-staff';
import { QrOrderService } from '@server/services/qr-order-service';
import { pushNotificationRoutes } from '@server/routes/push-notifications';
import type { AppEnv } from '@server/types';

const posRoutes = new Hono<AppEnv>();
posRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));
posRoutes.use('*', async (c, next) => {
  await next();
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) &&
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

posRoutes.get('/onboarding/audio/:track', async (c) => {
  const track = c.req.param('track');
  if (!/^(0[0-9]|1[0-3])$/.test(track)) {
    throw new AppError('ONBOARDING_AUDIO_NOT_FOUND', 'Không tìm thấy âm thanh hướng dẫn.', 404);
  }
  const object = await c.env.MEDIA.get(`onboarding/sound_${track}.MP3`);
  if (!object) {
    throw new AppError('ONBOARDING_AUDIO_NOT_FOUND', 'Không tìm thấy âm thanh hướng dẫn.', 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', 'audio/mpeg');
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

posRoutes.get('/sound/:soundName', async (c) => {
  const soundName = c.req.param('soundName');
  if (!/^[a-zA-Z0-9_\-.]+\.(ogg|mp3|wav|m4a)$/i.test(soundName)) {
    throw new AppError('SOUND_NOT_FOUND', 'Không tìm thấy file âm thanh.', 404);
  }
  const object =
    (await c.env.MEDIA.get(`sound/${soundName}`)) ?? (await c.env.MEDIA.get(soundName));
  if (!object) {
    throw new AppError('SOUND_NOT_FOUND', 'Không tìm thấy file âm thanh trong R2.', 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', soundName.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg');
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
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

posRoutes.get('/customers', requirePermission('order.add_customer'), async (c) => {
  const search = c.req.query('search')?.trim();
  return success(
    c,
    await new CustomerService(c.env).list(c.get('actor').storeId!, {
      ...(search ? { search } : {}),
      status: 'ACTIVE',
      page: 1,
      limit: 50,
    }),
  );
});
posRoutes.get('/customers/:id', requirePermission('order.add_customer'), async (c) =>
  success(c, await new CustomerService(c.env).detail(c.get('actor').storeId!, c.req.param('id'))),
);
posRoutes.post('/customers', requirePermission('order.add_customer'), async (c) => {
  const body = await parseJson(c.req.raw, customerInputSchema);
  const actor = c.get('actor');
  return success(c, await new CustomerService(c.env).create(actor.storeId!, actor.id, body), 201);
});
posRoutes.post(
  '/customers/:id/debt-payments',
  requirePermission('checkout.complete'),
  async (c) => {
    const body = await parseJson(c.req.raw, debtPaymentSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new CustomerService(c.env).payDebt(actor.storeId!, c.req.param('id'), actor.id, body),
    );
  },
);

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

posRoutes.get('/orders', requirePermission('order.manage'), async (c) =>
  success(c, await new PosService(c.env).listOrders(c.get('actor').storeId!)),
);

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
