import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { rm } from 'node:fs/promises';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
    {
      name: 'remove-deprecated-audio-assets',
      async closeBundle() {
        await rm(fileURLToPath(new URL('./dist/client/sound', import.meta.url)), {
          recursive: true,
          force: true,
        });
      },
    },
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'sw.js',
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
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
        globIgnores: ['**/sound/**'],
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'favicon.svg',
          'apple-touch-icon.png',
          'pwa-*.png',
          'assets/index-*.css',
          'assets/index-*.js',
          'assets/rolldown-runtime-*.js',
          'assets/api-*.js',
          'assets/result-*.js',
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
