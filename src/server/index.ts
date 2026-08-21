import { Hono } from 'hono';

import { AppError } from '@server/lib/app-error';
import { failure, success } from '@server/lib/response';
import { clearCredentialCookie } from '@server/lib/cookies';
import { activationRoutes, authRoutes } from '@server/routes/auth';
import { platformRoutes } from '@server/routes/platform';
import { ownerStaffRoutes } from '@server/routes/owner-staff';
import { ownerCatalogRoutes } from '@server/routes/owner-catalog';
import { mediaRoutes } from '@server/routes/media';
import { posRoutes } from '@server/routes/pos';
import { currentDeviceRoutes, ownerDeviceRoutes } from '@server/routes/devices';
import { ownerStoreRoutes } from '@server/routes/owner-store';
import { ownerInvoiceRoutes } from '@server/routes/owner-invoices';
import { ownerAnalyticsRoutes } from '@server/routes/owner-analytics';
import { guestOrderRoutes } from '@server/routes/guest-order';
import type { AppEnv } from '@server/types';
import { RealtimeDispatcher } from '@server/realtime/realtime-dispatcher';

export { StoreRealtimeRoom } from '@server/realtime/store-realtime-room';

const app = new Hono<AppEnv>();

app.get('/logout-callback', (c) => {
  clearCredentialCookie(c, 'session');
  clearCredentialCookie(c, 'activation');
  clearCredentialCookie(c, 'access');
  const target = c.req.query('target') || c.req.query('returnTo') || '/?tab=owner&loggedOut=1';
  return c.redirect(target, 303);
});

app.get('/cdn-cgi/access/logout', (c) => {
  clearCredentialCookie(c, 'session');
  clearCredentialCookie(c, 'activation');
  clearCredentialCookie(c, 'access');
  const target = c.req.query('target') || c.req.query('returnTo') || '/?tab=owner&loggedOut=1';
  return c.redirect(target, 303);
});

app.use('/api/*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  c.header('Cache-Control', 'no-store');
  await next();
});

app.get('/api/health', (c) =>
  success(c, {
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  }),
);

app.get('/api/version', (c) =>
  success(c, {
    version: c.env.APP_VERSION,
    environment: c.env.ENVIRONMENT,
    commit: c.env.BUILD_SHA,
    builtAt: c.env.BUILD_TIME,
  }),
);

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/device-activations', activationRoutes);
app.route('/api/v1/platform', platformRoutes);
app.route('/api/v1/owner/staff', ownerStaffRoutes);
app.route('/api/v1/owner/catalog', ownerCatalogRoutes);
app.route('/api/v1/media', mediaRoutes);
app.route('/api/v1/guest-order', guestOrderRoutes);
app.route('/api/v1/pos', posRoutes);
app.route('/api/v1/owner/devices', ownerDeviceRoutes);
app.route('/api/v1/devices/current', currentDeviceRoutes);
app.route('/api/v1/owner/store', ownerStoreRoutes);
app.route('/api/v1/owner/invoices', ownerInvoiceRoutes);
app.route('/api/v1/owner/analytics', ownerAnalyticsRoutes);

app.notFound((c) => failure(c, { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' }, 404));

app.onError((error, c) => {
  if (error instanceof AppError) {
    if (error.status === 429 && typeof error.details === 'object' && error.details) {
      const retryAfter = (error.details as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retryAfter) c.header('Retry-After', String(retryAfter));
    }
    return failure(
      c,
      { code: error.code, message: error.message, details: error.details },
      error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
    );
  }

  console.error(
    JSON.stringify({
      level: 'error',
      requestId: c.get('requestId'),
      route: c.req.path,
      message: error instanceof Error ? error.message : 'Unknown error',
    }),
  );
  return failure(
    c,
    {
      code: 'INTERNAL_ERROR',
      message: 'Hệ thống gặp lỗi.',
      ...(c.env.ENVIRONMENT === 'local' && error instanceof Error
        ? { details: { message: error.message } }
        : {}),
    },
    500,
  );
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: CloudflareBindings) {
    const dispatcher = new RealtimeDispatcher(env);
    if (controller.cron === '17 18 * * *') {
      await dispatcher.cleanupPublished();
      return;
    }
    await dispatcher.dispatchPendingStores();
  },
} satisfies ExportedHandler<CloudflareBindings>;
