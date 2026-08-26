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

const RUNTIME_ASSET_CACHE = 'propos-runtime-assets-v2';
const LEGACY_RUNTIME_ASSET_CACHES = new Set(['propos-runtime-assets-v1']);

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => LEGACY_RUNTIME_ASSET_CACHES.has(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      ),
  );
});

registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    (['script', 'style', 'image', 'audio'].includes(request.destination) ||
      url.pathname.endsWith('.mp3') ||
      url.pathname.startsWith('/sounds/')),
  async ({ request }) => {
    const cache = await caches.open(RUNTIME_ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  },
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
      const tag = payload.tag ?? 'propos-notification';

      const options = {
        body: payload.body ?? 'Bạn có thông báo mới.',
        icon: payload.icon ?? '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
        renotify: true,
        requireInteraction: payload.requireInteraction !== false,
        silent: true,
        timestamp: payload.timestamp ?? Date.now(),
        actions: [{ action: 'open', title: payload.actionTitle ?? 'Mở QR Order' }],
        data: {
          url: payload.url ?? '/pos/qr-order',
          tag,
          kind: payload.kind ?? 'QR_ORDER',
          requestId: payload.requestId ?? null,
          orderId: payload.orderId ?? null,
        },
        vibrate: [300, 120, 300, 120, 700],
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
