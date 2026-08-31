import { describe, expect, it } from 'vitest';

import type { AuthContextResponse, LoginResponse } from '@contracts/auth';
import { authContextAfterEmployeeLogin } from '@client/features/auth/employee-login-cache';

const login: LoginResponse = {
  actor: {
    id: 'employee-1',
    displayName: 'Thu ngân',
    kind: 'EMPLOYEE',
    storeId: 'store-1',
  },
  csrfToken: 'new-csrf-token',
};

describe('employee login auth cache', () => {
  it('seeds the new actor and CSRF while preserving the active device', () => {
    const current: AuthContextResponse = {
      actor: null,
      device: {
        id: 'device-1',
        name: 'Máy POS',
        status: 'ACTIVE',
        storeId: 'store-1',
        storeName: 'Cửa hàng 1',
      },
      allowedEntrypoints: ['EMPLOYEE'],
      csrfToken: null,
    };

    expect(authContextAfterEmployeeLogin(current, login)).toEqual({
      actor: login.actor,
      device: current.device,
      allowedEntrypoints: ['EMPLOYEE'],
      csrfToken: login.csrfToken,
    });
  });

  it('falls back to authoritative context when the cached device is not active', () => {
    const current: AuthContextResponse = {
      actor: null,
      device: null,
      allowedEntrypoints: [],
      csrfToken: null,
    };

    expect(authContextAfterEmployeeLogin(current, login)).toBeNull();
  });
});
