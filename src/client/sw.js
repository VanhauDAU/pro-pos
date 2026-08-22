import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
// eslint-disable-next-line no-underscore-dangle
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api(?:\/|$)/] }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function pushPayload(event) {
  try {
    return event.data?.json() ?? {};
  } catch {
    return { body: event.data?.text() ?? 'Bạn có thông báo mới.' };
  }
}

self.addEventListener('push', (event) => {
  const payload = pushPayload(event);
  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const audioClient =
        windowClients.find((client) => client.focused) ??
        windowClients.find((client) => client.visibilityState === 'visible');
      const soundType =
        payload.soundType === 'CHECKOUT_REQUEST' ? 'CHECKOUT_REQUEST' : 'NEW_QR_ORDER';
      const tag = payload.tag ?? 'propos-notification';

      if (audioClient) {
        audioClient.postMessage({
          type: 'PUSH_NOTIFICATION_RECEIVED',
          soundType,
          tag,
          receivedAt: Date.now(),
        }); // oxlint-disable-line unicorn/require-post-message-target-origin -- Service Worker Client API has no targetOrigin.
      }

      const options = {
        body: payload.body ?? 'Bạn có thông báo mới.',
        icon: payload.icon ?? '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
        renotify: true,
        requireInteraction: payload.requireInteraction !== false,
        silent: Boolean(audioClient),
        timestamp: payload.timestamp ?? Date.now(),
        actions: [{ action: 'open', title: payload.actionTitle ?? 'Mở QR Order' }],
        data: {
          url: payload.url ?? '/pos/qr-order',
          tag,
          kind: payload.kind ?? 'QR_ORDER',
          requestId: payload.requestId ?? null,
          orderId: payload.orderId ?? null,
        },
        ...(audioClient ? {} : { vibrate: [300, 120, 300, 120, 700] }),
      };

      await Promise.all([
        self.registration.showNotification(payload.title ?? 'Pro POS', options),
        typeof self.navigator?.setAppBadge === 'function'
          ? self.navigator.setAppBadge(payload.badgeCount)
          : Promise.resolve(),
      ]);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    Promise.all([
      typeof self.navigator?.clearAppBadge === 'function'
        ? self.navigator.clearAppBadge()
        : Promise.resolve(),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        const target = new URL(
          event.notification.data?.url ?? '/pos/qr-order',
          self.location.origin,
        ).href;
        const existing =
          clients.find((client) => client.focused) ??
          clients.find((client) => client.url.startsWith(self.location.origin));
        if (existing) return existing.focus().then(() => existing.navigate(target));
        return self.clients.openWindow(target);
      }),
    ]),
  );
});
