import type { Query, QueryClient } from '@tanstack/react-query';

import type { AppBootstrapResponse } from '@contracts/app-bootstrap';
import type { PosStaffContext } from '@contracts/pos';

import { posOfflineRuntime } from './runtime';

function sanitizedBootstrap(bootstrap: AppBootstrapResponse): AppBootstrapResponse {
  return {
    ...bootstrap,
    auth: { ...bootstrap.auth, csrfToken: null },
  };
}

async function persistQuery(queryClient: QueryClient, query: Query) {
  if (query.state.status !== 'success' || query.state.data === undefined) return;
  const key = query.queryKey;
  const context = queryClient.getQueryData<PosStaffContext>(['pos-context']);
  if (key[0] === 'app-bootstrap') {
    const bootstrap = query.state.data as AppBootstrapResponse;
    const storeId = bootstrap.pos?.context.storeId;
    if (!storeId || bootstrap.auth.actor?.kind !== 'EMPLOYEE') return;
    await Promise.all([
      posOfflineRuntime.repository.putSnapshot({
        storeId,
        kind: 'BOOTSTRAP',
        entityId: 'singleton',
        value: sanitizedBootstrap(bootstrap),
        serverVersion: null,
        updatedAt: Date.now(),
      }),
      posOfflineRuntime.repository.putMeta('lastStoreId', storeId),
      bootstrap.auth.device?.id
        ? posOfflineRuntime.repository.putMeta('installationDeviceId', bootstrap.auth.device.id)
        : Promise.resolve(),
    ]);
    posOfflineRuntime.configureStore(storeId);
    void posOfflineRuntime.syncNow();
    return;
  }
  if (!context) return;
  if (key[0] === 'pos-overview') {
    await posOfflineRuntime.repository.putSnapshot({
      storeId: context.storeId,
      kind: 'OVERVIEW',
      entityId: 'singleton',
      value: query.state.data,
      serverVersion: null,
      updatedAt: Date.now(),
    });
  }
  if (key[0] === 'pos-catalog') {
    await posOfflineRuntime.repository.putSnapshot({
      storeId: context.storeId,
      kind: 'CATALOG',
      entityId: 'singleton',
      value: query.state.data,
      serverVersion: null,
      updatedAt: Date.now(),
    });
  }
  if (key[0] === 'pos-order-quote' && typeof key[1] === 'string') {
    const version = (query.state.data as { order?: { version?: number } }).order?.version ?? null;
    await posOfflineRuntime.repository.putSnapshot({
      storeId: context.storeId,
      kind: 'ORDER_QUOTE',
      entityId: key[1],
      value: query.state.data,
      serverVersion: version,
      updatedAt: Date.now(),
    });
  }
}

export async function hydratePosQueries(queryClient: QueryClient) {
  try {
    const hasAuthError =
      typeof window !== 'undefined' && window.location.search.includes('authError');
    const hydration = await posOfflineRuntime.repository.hydration();
    if (hasAuthError && hydration.bootstrap) {
      const storeId = hydration.bootstrap.pos?.context.storeId ?? 'default';
      const sanitized: AppBootstrapResponse = {
        ...hydration.bootstrap,
        auth: { ...hydration.bootstrap.auth, actor: null, csrfToken: null },
      };
      await posOfflineRuntime.repository.putSnapshot({
        storeId,
        kind: 'BOOTSTRAP',
        entityId: 'singleton',
        value: sanitized,
        serverVersion: null,
        updatedAt: Date.now(),
      });
      queryClient.setQueryData(['app-bootstrap', 'areas'], sanitized);
      queryClient.setQueryData(['app-bootstrap', 'shell'], sanitized);
      queryClient.setQueryData(['auth-context'], sanitized.auth);
      if (sanitized.pos) {
        queryClient.setQueryData(['pos-context'], sanitized.pos.context);
      }
    } else {
      const expiry = hydration.bootstrap?.auth.offlineAccessExpiresAt ?? 0;
      if (
        hydration.bootstrap?.auth.actor?.kind === 'EMPLOYEE' &&
        hydration.bootstrap.pos &&
        expiry > Date.now()
      ) {
        queryClient.setQueryData(['app-bootstrap', 'areas'], hydration.bootstrap);
        queryClient.setQueryData(['app-bootstrap', 'shell'], hydration.bootstrap);
        queryClient.setQueryData(['auth-context'], hydration.bootstrap.auth);
        queryClient.setQueryData(['pos-context'], hydration.bootstrap.pos.context);
        if (hydration.overview) {
          queryClient.setQueryData(['pos-overview'], hydration.overview);
          queryClient.setQueryData(['pos-tables'], hydration.overview.tables);
          queryClient.setQueryData(['pos-orders-list'], hydration.overview.orders);
        }
        if (hydration.catalog) queryClient.setQueryData(['pos-catalog'], hydration.catalog);
        for (const quote of hydration.orderQuotes) {
          queryClient.setQueryData(['pos-order-quote', quote.orderId], quote.value);
        }
      }
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[POS offline] IndexedDB hydration failed', error);
  }
  posOfflineRuntime.initialize(queryClient);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') {
      void persistQuery(queryClient, event.query).catch((error: unknown) => {
        if (import.meta.env.DEV) console.warn('[POS offline] snapshot persistence failed', error);
      });
    }
  });
}
