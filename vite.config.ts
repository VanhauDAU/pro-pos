import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function devServiceWorkerPlugin(): import('vite').Plugin {
  return {
    name: 'dev-sw-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/sw.js') {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Service-Worker-Allowed', '/');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.end(
            `
self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : 'Bạn có thông báo mới.' };
  }
  event.waitUntil(
    (async () => {
      const tag = payload.tag || 'propos-notification';

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('propos-notifications');
          bc.postMessage({ type: 'PUSH_NOTIFICATION_RECEIVED', payload });
          bc.close();
        }
      } catch {}

      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'PUSH_NOTIFICATION_RECEIVED', payload });
        }
      } catch {}

      const isPaid = payload.kind === 'ORDER_PAID';
      const defaultTitle = isPaid ? 'Xem hóa đơn' : 'Mở POS';
      const defaultUrl = isPaid ? '/pos' : '/pos/qr-order';

      const soundMap = {
        ORDER_PAID: '/sounds/sound_thanhtoanthanhcong.mp3',
        PAYMENT_SUCCESS: '/sounds/sound_thanhtoanthanhcong.mp3',
        QR_ORDER: '/sounds/sound_goimonmoi.mp3',
        NEW_QR_ORDER: '/sounds/sound_goimonmoi.mp3',
        CALL_STAFF: '/sounds/sound_yeuccaumoban.mp3',
        CHECKOUT_REQUEST: '/sounds/sound_yeucauthanhtoan.mp3',
        TABLE_OPEN_REQUEST: '/sounds/sound_yeuccaumoban.mp3',
      };
      const soundFile =
        (payload.soundType && soundMap[payload.soundType]) ||
        (payload.kind && soundMap[payload.kind]) ||
        undefined;

      const options = {
        body: payload.body || 'Bạn có thông báo mới.',
        icon: payload.icon || '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
        renotify: true,
        requireInteraction: payload.requireInteraction !== false,
        silent: false,
        ...(soundFile ? { sound: soundFile } : {}),
        timestamp: payload.timestamp || Date.now(),
        actions: [{ action: 'open', title: payload.actionTitle || defaultTitle }],
        data: {
          url: payload.url || defaultUrl,
          tag,
          kind: payload.kind || 'NOTIFICATION',
          requestId: payload.requestId || null,
          orderId: payload.orderId || null,
          soundType: payload.soundType || null,
        },
        vibrate: [200, 100, 200, 100, 400],
      };
      await self.registration.showNotification(payload.title || 'Pro POS', options);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const urlToOpen = new URL(event.notification.data?.url || '/pos', self.location.origin).href;
      const focused = clientList.find((client) => client.focused) || clientList.find((client) => client.url.startsWith(self.location.origin));
      if (focused) {
        return focused.focus().then(() => focused.navigate(urlToOpen));
      }
      return self.clients.openWindow(urlToOpen);
    })
  );
});
            `.trim(),
          );
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    PROPOS_APP_VERSION: JSON.stringify(process.env['npm_package_version'] ?? 'unknown'),
  },
  environments: {
    client: {
      build: {
        assetsInlineLimit: 0,
        manifest: true,
        modulePreload: {
          resolveDependencies(filename, dependencies) {
            if (!filename.includes('StaffPosPortalPage')) return dependencies;
            return dependencies.filter(
              (dependency) => !/\/(?:OrderDetailPage|pos-receipt-printer)-/.test(dependency),
            );
          },
        },
        rolldownOptions: {
          output: {
            strictExecutionOrder: true,
            codeSplitting: {
              groups: [
                {
                  name: 'vendor-initial',
                  test: /node_modules[\\/]/,
                  tags: ['$initial'],
                  priority: 20,
                  minSize: 20_000,
                  maxSize: 4_000_000,
                },
                {
                  name: 'vendor',
                  test: /node_modules[\\/]/,
                  priority: 10,
                  entriesAware: true,
                  entriesAwareMergeThreshold: 10_000,
                  minSize: 20_000,
                  maxSize: 4_000_000,
                },
              ],
            },
          },
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  resolve: {
    alias: {
      '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
      '@contracts': fileURLToPath(new URL('./src/contracts', import.meta.url)),
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@printing': fileURLToPath(new URL('./src/printing', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
    },
  },
  plugins: [
    react(),
    cloudflare(),
    devServiceWorkerPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'sw.js',
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pro-pos-logo-black.svg'],
      manifest: {
        id: '/',
        name: 'Pro POS',
        short_name: 'Pro POS',
        description: 'Hệ thống quản lý cửa hàng billiards',
        theme_color: '#0D7CFF',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/pos',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'favicon.svg',
          'apple-touch-icon.png',
          'pwa-*.png',
          'assets/*.js',
          'assets/*.css',
          'assets/*.webp',
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
