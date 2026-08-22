import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { PlatformRepository } from '@server/repositories/platform-repository';
import { PlatformService } from '@server/services/platform-service';
import { AuthService } from '@server/services/auth-service';
import type { OwnerAccountProfile } from '@contracts/auth';

const ORIGIN = 'https://pro-pos.test';
const OWNER_EMAIL = 'owner.account.test@example.com';
const OWNER_USERNAME = 'owner.acc.test';
const INITIAL_PASSWORD = 'AccountPassword123!';

async function seedStore() {
  const platform = new PlatformService(env);
  if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.admin@example.com',
      displayName: 'System Admin',
      password: 'AdminPassword123!',
    });
  }
  return platform.createStore({
    name: 'Account Test Store',
    ownerDisplayName: 'Chủ Cửa Hàng Thử Nghiệm',
    ownerEmail: OWNER_EMAIL,
    ownerUsername: OWNER_USERNAME,
    ownerPassword: INITIAL_PASSWORD,
  });
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get('Set-Cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

async function jsonData<T>(response: Response) {
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

describe('Owner Account Settings API', () => {
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    await seedStore();

    // Login as owner
    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: OWNER_USERNAME,
        password: INITIAL_PASSWORD,
      }),
    });
    expect(login.status).toBe(200);
    sessionCookie = cookieValue(login, '__Host-propos-session')!;
    const data = await jsonData<{ csrfToken: string }>(login);
    csrfToken = data.csrfToken;
  });

  it('retrieves owner account profile successfully', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/owner/account`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });

    expect(res.status).toBe(200);
    const profile = await jsonData<OwnerAccountProfile>(res);
    expect(profile.username).toBe(OWNER_USERNAME);
    expect(profile.displayName).toBe('Chủ Cửa Hàng Thử Nghiệm');
    expect(profile.email).toBe(OWNER_EMAIL);
    expect(profile.storeName).toBe('Account Test Store');
    expect(profile.status).toBe('ACTIVE');
  });

  it('updates owner personal information (displayName, phone, email)', async () => {
    const updateRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/account`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        displayName: 'Nguyễn Văn Chủ Mới',
        phone: '0987654321',
        email: 'new.email@example.com',
      }),
    });

    expect(updateRes.status).toBe(200);
    const updated = await jsonData<OwnerAccountProfile>(updateRes);
    expect(updated.displayName).toBe('Nguyễn Văn Chủ Mới');
    expect(updated.phone).toBe('0987654321');
    expect(updated.email).toBe('new.email@example.com');
    expect(updated.username).toBe(OWNER_USERNAME); // Username stays unchanged

    // Verify persisted in DB
    const getRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/account`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    expect(getRes.status).toBe(200);
    const fetched = await jsonData<OwnerAccountProfile>(getRes);
    expect(fetched.displayName).toBe('Nguyễn Văn Chủ Mới');
    expect(fetched.phone).toBe('0987654321');
    expect(fetched.email).toBe('new.email@example.com');
  });

  it('rejects update when email is already in use by another user', async () => {
    // Seed another user with a specific email
    const platform = new PlatformService(env);
    await platform.createStore({
      name: 'Another Store',
      ownerDisplayName: 'Another Owner',
      ownerEmail: 'conflict.owner@example.com',
      ownerUsername: 'conflict.owner',
      ownerPassword: 'Password123!',
    });

    const updateRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/account`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        displayName: 'Nguyễn Văn Chủ',
        phone: '0987654321',
        email: 'conflict.owner@example.com',
      }),
    });

    expect(updateRes.status).toBe(409);
    const errorJson = (await updateRes.json()) as { error: { code: string } };
    expect(errorJson.error.code).toBe('EMAIL_ALREADY_IN_USE');
  });

  it('rejects update with invalid Vietnam phone format', async () => {
    const updateRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/account`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        displayName: 'Nguyễn Văn Chủ',
        phone: '12345',
        email: 'valid@example.com',
      }),
    });

    expect(updateRes.status).toBe(422);
  });

  it('rejects password change with incorrect current password', async () => {
    const changeRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/account/change-password`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        currentPassword: 'WrongCurrentPassword!',
        newPassword: 'AnotherPassword123!',
      }),
    });

    expect(changeRes.status).toBe(400);
    const err = (await changeRes.json()) as { error: { code: string } };
    expect(err.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('allows owner to change password via owner account endpoint and login with new password', async () => {
    const changeRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/account/change-password`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        currentPassword: INITIAL_PASSWORD,
        newPassword: 'BrandNewSecurePass999!',
      }),
    });

    expect(changeRes.status).toBe(200);
    const changeData = await jsonData<{ success: boolean }>(changeRes);
    expect(changeData.success).toBe(true);

    // Verify login with new password succeeds
    const authService = new AuthService(env);
    const loginRes = await authService.ownerLogin({
      username: OWNER_USERNAME,
      password: 'BrandNewSecurePass999!',
    });
    expect(loginRes.response.actor.displayName).toBe('Nguyễn Văn Chủ Mới');
  });
});

