import 'antd/dist/reset.css';
import './styles/base.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { ApiError } from './lib/api';

const PRELOAD_RECOVERY_KEY = 'propos-preload-recovery-at';

window.addEventListener('vite:preloadError', (event) => {
  const lastRecoveryAt = Number(window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY) ?? '0');
  if (Date.now() - lastRecoveryAt < 10_000) return;
  event.preventDefault();
  window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(Date.now()));
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [401, 403, 409, 422].includes(error.status)) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#0975F7',
            borderRadius: 8,
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
        }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
);
