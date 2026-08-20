import { Hono } from 'hono';

import {
  addOrderItemSchema,
  cancelOrderSchema,
  checkoutSchema,
  openTableSchema,
  timeActionSchema,
  transferTableSchema,
} from '@contracts/pos';
import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { PosService } from '@server/services/pos-service';
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
    }),
    201,
  );
});

posRoutes.get('/orders/:orderId/quote', requirePermission('table.view'), async (c) =>
  success(c, await new PosService(c.env).quote(c.get('actor').storeId!, c.req.param('orderId'))),
);

posRoutes.post('/orders/:orderId/items', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, addOrderItemSchema);
  const actor = c.get('actor');
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
      quantityMilli: body.quantityMilli,
      expectedOrderVersion: body.expectedOrderVersion,
      discount: body.discount ?? null,
    }),
    201,
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
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
    }),
  );
});

posRoutes.post('/orders/:orderId/time/resume', requirePermission('time.pause'), async (c) => {
  const body = await parseJson(c.req.raw, timeActionSchema);
  return success(
    c,
    await new PosService(c.env).resume({
      storeId: c.get('actor').storeId!,
      orderId: c.req.param('orderId'),
      expectedOrderVersion: body.expectedOrderVersion,
    }),
  );
});

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
