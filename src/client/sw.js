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

self.addEventListener('push', (event) => {
  const payload = event.data?.json?.() ?? {};
  const title = payload.title ?? 'Pro POS';
  const options = {
    body: payload.body ?? 'Bạn có thông báo mới.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag ?? 'propos-notification',
    renotify: true,
    vibrate: [250, 100, 250, 100, 500],
    data: { url: payload.url ?? '/pos/qr-order' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const target = new URL(event.notification.data?.url ?? '/pos/qr-order', self.location.origin)
        .href;
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) return existing.focus().then(() => existing.navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
