import { Hono } from 'hono';

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
import type { AppEnv } from '@server/types';

const posRoutes = new Hono<AppEnv>();
posRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));

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

posRoutes.get('/print-settings', requirePermission('order.manage'), async (c) =>
  success(c, await new StoreService(c.env).getPrintSettings(c.get('actor').storeId!)),
);

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

posRoutes.get('/invoices', requirePermission('invoice.view'), async (c) =>
  success(c, await new PosService(c.env).listInvoices(c.get('actor').storeId!)),
);

posRoutes.get('/invoices/:invoiceId', requirePermission('invoice.view'), async (c) =>
  success(
    c,
    await new PosService(c.env).getInvoice(c.get('actor').storeId!, c.req.param('invoiceId')),
  ),
);

export { posRoutes };
