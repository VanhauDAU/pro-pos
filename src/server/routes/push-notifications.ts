import { z } from 'zod';
import { Hono } from 'hono';

import { pushSubscriptionSchema } from '@contracts/qr-order';
import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { PushSubscriptionRepository } from '@server/repositories/push-subscription-repository';
import { PushNotificationService } from '@server/services/push-notification-service';
import type { AppEnv } from '@server/types';

const pushNotificationRoutes = new Hono<AppEnv>();

pushNotificationRoutes.get('/public-key', (c) => {
  const service = new PushNotificationService(c.env);
  if (!service.isConfigured()) {
    throw new AppError('PUSH_NOT_CONFIGURED', 'Push notification chưa được cấu hình.', 503);
  }
  return success(c, { publicKey: c.env.VAPID_PUBLIC_KEY });
});

pushNotificationRoutes.post('/subscriptions', async (c) => {
  const body = await parseJson(c.req.raw, pushSubscriptionSchema);
  const actor = c.get('actor');
  await new PushSubscriptionRepository(c.env.DB).upsert({
    storeId: actor.storeId!,
    userId: actor.id,
    deviceId: c.get('device')?.id ?? null,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: c.req.header('User-Agent') ?? null,
    now: Date.now(),
  });
  return success(c, { subscribed: true }, 201);
});

const unsubscribeSchema = z
  .object({
    endpoint: z.string().optional(),
  })
  .optional();

pushNotificationRoutes.delete('/subscriptions', async (c) => {
  const actor = c.get('actor');
  const deviceId = c.get('device')?.id ?? null;
  const body = c.req.header('content-type')?.includes('application/json')
    ? await parseJson(c.req.raw, unsubscribeSchema)
    : undefined;
  const endpoint = body?.endpoint;
  const repo = new PushSubscriptionRepository(c.env.DB);
  if (endpoint) {
    await repo.removeByEndpoint(endpoint);
  } else if (deviceId && actor.storeId) {
    await repo.removeByDevice(actor.storeId, deviceId);
  } else if (actor.storeId) {
    await repo.removeByUser(actor.storeId, actor.id);
  }
  return success(c, { unsubscribed: true });
});

export { pushNotificationRoutes };
