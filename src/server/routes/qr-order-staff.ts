import { Hono } from 'hono';
import { z } from 'zod';

import { acceptGuestOrderSchema, rejectGuestOrderSchema } from '@contracts/qr-order';
import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requirePermission } from '@server/middleware/authorization';
import { QrOrderService } from '@server/services/qr-order-service';
import type { AppEnv } from '@server/types';

const qrOrderStaffRoutes = new Hono<AppEnv>();

function idempotencyKey(c: Parameters<typeof success>[0]) {
  const value = c.req.header('Idempotency-Key');
  if (!value || value.length < 8 || value.length > 128) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Thiếu Idempotency-Key hợp lệ.', 422);
  }
  return value;
}

qrOrderStaffRoutes.get('/', requirePermission('table.view'), async (c) =>
  success(
    c,
    await new QrOrderService(c.env).listStaffRequests(
      c.get('actor').storeId!,
      c.req.query('status'),
    ),
  ),
);

qrOrderStaffRoutes.get('/audit', requirePermission('table.view'), async (c) => {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('AUDIT_LIMIT_INVALID', 'Giới hạn nhật ký phải từ 1 đến 100.', 422);
  }
  return success(
    c,
    await new QrOrderService(c.env).listNotificationAudit(c.get('actor').storeId!, limit),
  );
});

qrOrderStaffRoutes.post('/:id/accept', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, acceptGuestOrderSchema);
  return success(
    c,
    await new QrOrderService(c.env).accept({
      commandId: idempotencyKey(c),
      storeId: c.get('actor').storeId!,
      guestRequestId: c.req.param('id'),
      expectedOrderVersion: body.expectedOrderVersion,
      actorId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  );
});

qrOrderStaffRoutes.post('/:id/reject', requirePermission('order.manage'), async (c) => {
  const body = await parseJson(c.req.raw, rejectGuestOrderSchema);
  return success(
    c,
    await new QrOrderService(c.env).reject({
      commandId: idempotencyKey(c),
      storeId: c.get('actor').storeId!,
      guestRequestId: c.req.param('id'),
      reason: body.reason,
      actorId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  );
});

qrOrderStaffRoutes.get('/service-requests/list', requirePermission('table.view'), async (c) =>
  success(c, await new QrOrderService(c.env).listServiceRequests(c.get('actor').storeId!)),
);

qrOrderStaffRoutes.get('/table-open-requests/list', requirePermission('table.view'), async (c) =>
  success(c, await new QrOrderService(c.env).listTableOpenRequests(c.get('actor').storeId!)),
);

qrOrderStaffRoutes.post(
  '/table-open-requests/:id/accept',
  requirePermission('table.open'),
  async (c) => {
    const actor = c.get('actor');
    return success(
      c,
      await new QrOrderService(c.env).acceptTableOpenRequest({
        storeId: actor.storeId!,
        id: c.req.param('id'),
        actorId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
        idempotencyKey: idempotencyKey(c),
      }),
    );
  },
);

qrOrderStaffRoutes.post(
  '/table-open-requests/:id/cancel',
  requirePermission('table.open'),
  async (c) => {
    const body = await parseJson(c.req.raw, rejectGuestOrderSchema);
    const actor = c.get('actor');
    return success(
      c,
      await new QrOrderService(c.env).cancelTableOpenRequest({
        storeId: actor.storeId!,
        id: c.req.param('id'),
        actorId: actor.id,
        reason: body.reason,
      }),
    );
  },
);

qrOrderStaffRoutes.post(
  '/service-requests/:id/status',
  requirePermission('order.manage'),
  async (c) => {
    const body = await parseJson(
      c.req.raw,
      z.object({ action: z.enum(['ACKNOWLEDGE', 'COMPLETE']) }),
    );
    return success(
      c,
      await new QrOrderService(c.env).updateService({
        storeId: c.get('actor').storeId!,
        id: c.req.param('id'),
        action: body.action,
        actorId: c.get('actor').id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      }),
    );
  },
);

export { qrOrderStaffRoutes };
