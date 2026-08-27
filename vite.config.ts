import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                {
                  name: 'vendor',
                  test: /node_modules[\\/]/,
                  priority: 10,
                  entriesAware: true,
                  entriesAwareMergeThreshold: 50_000,
                  minSize: 20_000,
                  maxSize: 500_000,
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
      '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
    },
  },
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'sw.js',
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'sounds/*.mp3'],
      manifest: {
        id: '/',
        name: 'Pro POS',
        short_name: 'Pro POS',
        description: 'Hệ thống quản lý cửa hàng billiards',
        theme_color: '#0D7CFF',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
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
          'sounds/*.mp3',
          'pwa-*.png',
          'assets/index-*.css',
          'assets/index-*.js',
          'assets/rolldown-runtime-*.js',
          'assets/api-*.js',
          'assets/typography-*.js',
          'assets/spin-*.js',
          'assets/ShopOutlined-*.js',
          'assets/LockOutlined-*.js',
          'assets/hooks-*.js',
          'assets/components-*.js',
          'assets/input-*.js',
          'assets/UserOutlined-*.js',
          'assets/lib-*.js',
          'assets/MailOutlined-*.js',
          'assets/workbox-window*.js',
        ],
      },
    }),
  ],
});
