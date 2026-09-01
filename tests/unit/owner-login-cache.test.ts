import { describe, expect, it } from 'vitest';

import type { AuthContextResponse, LoginResponse } from '@contracts/auth';
import { authContextAfterOwnerLogin } from '@client/features/auth/owner-login-cache';

const login: LoginResponse = {
  actor: {
    id: 'owner-1',
    displayName: 'Chủ cửa hàng',
    kind: 'OWNER',
    storeId: 'store-1',
  },
  csrfToken: 'new-csrf-token',
};

describe('owner login auth cache', () => {
  it('replaces the anonymous actor immediately while preserving the device context', () => {
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

    expect(authContextAfterOwnerLogin(current, login)).toEqual({
      actor: login.actor,
      device: current.device,
      allowedEntrypoints: ['EMPLOYEE', 'OWNER'],
      csrfToken: login.csrfToken,
    });
  });

  it('creates a complete owner context when no bootstrap context exists', () => {
    expect(authContextAfterOwnerLogin(undefined, login)).toEqual({
      actor: login.actor,
      device: null,
      allowedEntrypoints: ['OWNER'],
      csrfToken: login.csrfToken,
    });
  });
});
