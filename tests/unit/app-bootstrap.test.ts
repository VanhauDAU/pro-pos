import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppBootstrapResponse } from '@contracts/app-bootstrap';
import { fetchFreshAppBootstrap } from '@client/features/bootstrap/app-bootstrap';

const anonymousBootstrap: AppBootstrapResponse = {
  auth: {
    actor: null,
    device: null,
    allowedEntrypoints: [],
    csrfToken: null,
  },
  pos: null,
};

const employeeBootstrap: AppBootstrapResponse = {
  auth: {
    actor: {
      id: 'employee-1',
      displayName: 'Thu ngân',
      kind: 'EMPLOYEE',
      storeId: 'store-1',
    },
    device: {
      id: 'device-1',
      name: 'Máy POS',
      status: 'ACTIVE',
      storeId: 'store-1',
      storeName: 'Cửa hàng 1',
    },
    allowedEntrypoints: ['EMPLOYEE'],
    csrfToken: 'employee-csrf',
  },
  pos: {
    context: {
      storeId: 'store-1',
      storeName: 'Cửa hàng 1',
      employeeId: 'employee-1',
      employeeName: 'Thu ngân',
      permissions: ['table.view'],
      capabilities: {
        posRealtime: true,
        posCommandsV2: true,
        posPaymentSnapshotV2: true,
        posRealtimeDeltasV2: true,
      },
    },
    overview: { tables: [], orders: [], serverNowMs: 1_788_336_000_000 },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fresh app bootstrap after authentication changes', () => {
  it('does not reuse a still-fresh bootstrap from the previous session', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(['app-bootstrap', 'areas'], anonymousBootstrap);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: employeeBootstrap }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFreshAppBootstrap(queryClient, 'areas');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(employeeBootstrap);
    expect(queryClient.getQueryData(['app-bootstrap', 'areas'])).toEqual(employeeBootstrap);
    expect(queryClient.getQueryData(['auth-context'])).toEqual(employeeBootstrap.auth);
  });
});
