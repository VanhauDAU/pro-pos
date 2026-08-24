import { Hono } from 'hono';
import { z } from 'zod';

import {
  createServiceRequestSchema,
  submitGuestOrderSchema,
  verifyGuestLocationSchema,
} from '@contracts/qr-order';
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

function formatPushMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

function compactPushBody(parts: Array<string | null | undefined>, maxLength = 220) {
  const value = parts.filter(Boolean).join(' • ');
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

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
  if (result.rawGuest) {
    setCredentialCookie(c, 'guest', result.rawGuest, 8 * 60 * 60);
  }
  return success(c, result.context);
});

guestOrderRoutes.post('/resolve/:token/open-request', async (c) => {
  assertSameOrigin(c);
  let location: z.infer<typeof verifyGuestLocationSchema> | undefined;
  if (c.req.header('content-type')?.includes('application/json')) {
    const rawBody = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (rawBody && typeof rawBody === 'object') {
      const locData = 'location' in rawBody ? rawBody.location : rawBody;
      const parsed = verifyGuestLocationSchema.safeParse(locData);
      if (parsed.success) {
        location = parsed.data;
      }
    }
  }
  const result = await new QrOrderService(c.env).requestTableOpen(
    c.req.param('token'),
    clientIp(c),
    location,
  );
  if (!result.alreadyOpen && !result.replayed && result.requestId && result.createdAt) {
    c.executionCtx.waitUntil(
      Promise.all([
        new RealtimeDispatcher(c.env).dispatchStore(result.storeId),
        new PushNotificationService(c.env).sendStoreNotification({
          storeId: result.storeId,
          kind: 'TABLE_OPEN_REQUEST',
          soundType: 'TABLE_OPEN_REQUEST',
          title: `🪑 ${result.tableName} yêu cầu mở bàn`,
          body: compactPushBody([result.areaName, 'Khách đang chờ để bắt đầu gọi món']),
          url: '/pos/qr-order',
          tag: `table-open-request:${result.requestId}`,
          timestamp: result.createdAt,
          requestId: result.requestId,
          orderId: '',
          actionTitle: 'Xem và mở bàn',
          badgeCount: 1,
          requireInteraction: true,
        }),
      ]).catch(() => undefined),
    );
  }
  return success(c, { requestId: result.requestId, alreadyOpen: result.alreadyOpen }, 201);
});

guestOrderRoutes.post('/location/verify', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, verifyGuestLocationSchema);
  const result = await new QrOrderService(c.env).verifyLocation(guestCredential(c), body);
  return success(c, result);
});

guestOrderRoutes.post('/resolve/:token/location/verify', async (c) => {
  assertSameOrigin(c);
  const body = await parseJson(c.req.raw, verifyGuestLocationSchema);
  const result = await new QrOrderService(c.env).verifyLocationByToken(c.req.param('token'), body);
  return success(c, result);
});

guestOrderRoutes.get('/context', async (c) =>
  success(c, await new QrOrderService(c.env).getContext(guestCredential(c))),
);

guestOrderRoutes.get('/active-order', async (c) =>
  success(c, await new QrOrderService(c.env).getActiveOrderBySession(guestCredential(c))),
);

guestOrderRoutes.get('/resolve/:token/active-order', async (c) =>
  success(c, await new QrOrderService(c.env).getActiveOrderByQr(c.req.param('token'))),
);

guestOrderRoutes.get('/resolve/:token/media/:mediaId', async (c) => {
  const result = await new QrOrderService(c.env).getMediaByQr(
    c.req.param('token'),
    c.req.param('mediaId'),
  );
  const headers = new Headers();
  result.object.writeHttpMetadata(headers);
  headers.set('ETag', result.object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(result.object.body, { headers });
});

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
  if ('items' in result) {
    const totalQuantity = result.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalVnd = result.items.reduce((sum, item) => sum + item.lineTotalVnd, 0);
    const itemSummary = result.items
      .slice(0, 3)
      .map((item) => {
        const variant =
          item.variantName && item.variantName !== 'Mặc định' ? ` ${item.variantName}` : '';
        return `${item.productName}${variant} ×${item.quantity}`;
      })
      .join(', ');
    const moreCount = Math.max(0, result.items.length - 3);
    c.executionCtx.waitUntil(
      Promise.all([
        new RealtimeDispatcher(c.env).dispatchStore(result.storeId),
        new PushNotificationService(c.env).sendStoreNotification({
          storeId: result.storeId,
          kind: 'QR_ORDER',
          soundType: 'NEW_QR_ORDER',
          title: `🍽️ ${result.tableName}: ${totalQuantity} món mới`,
          body: compactPushBody([
            result.areaName,
            `${itemSummary}${moreCount > 0 ? `, +${moreCount} dòng món` : ''}`,
            `Tổng ${formatPushMoney(totalVnd)}`,
            result.note ? `Ghi chú: ${result.note}` : null,
          ]),
          url: '/pos/qr-order',
          tag: `qr-order:${result.requestId}`,
          timestamp: result.createdAt,
          requestId: result.requestId,
          orderId: result.orderId,
          actionTitle: 'Xem và xác nhận',
          badgeCount: 1,
          requireInteraction: true,
        }),
      ]).catch(() => undefined),
    );
  }
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
        kind: body.type,
        soundType: body.type === 'CHECKOUT_REQUEST' ? 'CHECKOUT_REQUEST' : 'NEW_QR_ORDER',
        title:
          body.type === 'CALL_STAFF'
            ? `🔔 ${result.tableName} gọi nhân viên`
            : `💳 ${result.tableName} yêu cầu thanh toán`,
        body: compactPushBody([
          result.areaName,
          body.type === 'CALL_STAFF'
            ? 'Khách đang chờ nhân viên hỗ trợ'
            : 'Khách đã sẵn sàng thanh toán',
          `Gửi lúc ${new Intl.DateTimeFormat('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh',
          }).format(result.createdAt)}`,
        ]),
        url: '/pos/qr-order',
        tag: `service-request:${result.id}`,
        timestamp: result.createdAt,
        requestId: result.id,
        orderId: result.orderId,
        actionTitle: body.type === 'CALL_STAFF' ? 'Tiếp nhận' : 'Mở thanh toán',
        badgeCount: 1,
        requireInteraction: true,
      }),
    ]).catch(() => undefined),
  );
  return success(c, { id: result.id, status: result.status }, 201);
});

export { guestOrderRoutes };
