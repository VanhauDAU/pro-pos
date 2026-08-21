import { Hono } from 'hono';

import { createServiceRequestSchema, submitGuestOrderSchema } from '@contracts/qr-order';
import { AppError } from '@server/lib/app-error';
import { readCredentialCookie, setCredentialCookie } from '@server/lib/cookies';
import { success } from '@server/lib/response';
import { assertSameOrigin } from '@server/lib/security';
import { parseJson } from '@server/lib/validation';
import { RealtimeDispatcher } from '@server/realtime/realtime-dispatcher';
import { PushNotificationService } from '@server/services/push-notification-service';
import { QrOrderService } from '@server/services/qr-order-service';
import type { AppEnv } from '@server/types';

const guestOrderRoutes = new Hono<AppEnv>();

function guestCredential(c: Parameters<typeof success>[0]) {
  const raw = readCredentialCookie(c, 'guest');
  if (!raw) throw new AppError('GUEST_SESSION_REQUIRED', 'Vui lòng quét lại mã QR trên bàn.', 401);
  return raw;
}

function clientIp(c: Parameters<typeof success>[0]) {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  );
}

guestOrderRoutes.get('/resolve/:token', async (c) => {
  const rawGuest = readCredentialCookie(c, 'guest');
  const result = await new QrOrderService(c.env).resolveQr({
    rawQrToken: c.req.param('token'),
    ...(rawGuest ? { rawGuest } : {}),
    ip: clientIp(c),
    deviceNonce: c.req.header('X-Guest-Device') ?? null,
  });
  setCredentialCookie(c, 'guest', result.rawGuest, 8 * 60 * 60);
  return success(c, result.context);
});

guestOrderRoutes.get('/context', async (c) =>
  success(c, await new QrOrderService(c.env).getContext(guestCredential(c))),
);

guestOrderRoutes.get('/requests', async (c) =>
  success(c, await new QrOrderService(c.env).listGuestRequests(guestCredential(c))),
);

guestOrderRoutes.get('/media/:mediaId', async (c) => {
  const result = await new QrOrderService(c.env).getMedia(
    guestCredential(c),
    c.req.param('mediaId'),
  );
  const headers = new Headers();
  result.object.writeHttpMetadata(headers);
  headers.set('ETag', result.object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(result.object.body, { headers });
});

guestOrderRoutes.post('/requests', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, submitGuestOrderSchema);
  const rawGuest = guestCredential(c);
  const result = await new QrOrderService(c.env).submitOrder(rawGuest, body, clientIp(c));
  c.executionCtx.waitUntil(
    Promise.all([
      new RealtimeDispatcher(c.env).dispatchStore(result.storeId),
      new PushNotificationService(c.env).sendStoreNotification({
        storeId: result.storeId,
        title: 'QR Order mới',
        body: `${result.tableName} vừa gọi món`,
        url: '/pos/qr-order',
        tag: `qr-order:${result.requestId}`,
      }),
    ]).catch(() => undefined),
  );
  return success(c, { requestId: result.requestId, replayed: result.replayed }, 201);
});

guestOrderRoutes.post('/service-requests', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, createServiceRequestSchema);
  const result = await new QrOrderService(c.env).createServiceRequest(
    guestCredential(c),
    body.type,
  );
  c.executionCtx.waitUntil(
    Promise.all([
      new RealtimeDispatcher(c.env).dispatchStore(result.storeId),
      new PushNotificationService(c.env).sendStoreNotification({
        storeId: result.storeId,
        title: result.status === 'OPEN' ? 'Yêu cầu từ khách' : 'Pro POS',
        body: `${result.tableName}: ${body.type === 'CALL_STAFF' ? 'Gọi nhân viên' : 'Yêu cầu thanh toán'}`,
        url: '/pos/qr-order',
        tag: `service-request:${result.id}`,
      }),
    ]).catch(() => undefined),
  );
  return success(c, { id: result.id, status: result.status }, 201);
});

export { guestOrderRoutes };
