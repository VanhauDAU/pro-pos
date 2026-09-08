import { queryOptions, type QueryClient } from '@tanstack/react-query';

import type { AppBootstrapResponse, AppBootstrapSurface } from '@contracts/app-bootstrap';

import { apiRequest } from '@client/lib/api';

export const APP_BOOTSTRAP_QUERY_KEY = ['app-bootstrap'] as const;

function seedBootstrapData(queryClient: QueryClient, bootstrap: AppBootstrapResponse) {
  queryClient.setQueryData(['auth-context'], bootstrap.auth);
  if (!bootstrap.pos) return;
  queryClient.setQueryData(['pos-context'], bootstrap.pos.context);
  if (!bootstrap.pos.overview) return;
  queryClient.setQueryData(['pos-overview'], bootstrap.pos.overview);
  queryClient.setQueryData(['pos-tables'], bootstrap.pos.overview.tables);
  queryClient.setQueryData(['pos-orders-list'], bootstrap.pos.overview.orders);
}

export function appBootstrapQueryOptions(queryClient: QueryClient, surface: AppBootstrapSurface) {
  return queryOptions({
    queryKey: [...APP_BOOTSTRAP_QUERY_KEY, surface] as const,
    queryFn: async ({ signal }) => {
      const bootstrap = await apiRequest<AppBootstrapResponse>(
        `/api/v1/app/bootstrap?surface=${surface}`,
        { signal },
      );
      seedBootstrapData(queryClient, bootstrap);
      return bootstrap;
    },
    staleTime: 5_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function resetAppBootstrap(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: APP_BOOTSTRAP_QUERY_KEY });
}

export function fetchFreshAppBootstrap(queryClient: QueryClient, surface: AppBootstrapSurface) {
  resetAppBootstrap(queryClient);
  return queryClient.fetchQuery(appBootstrapQueryOptions(queryClient, surface));
}
