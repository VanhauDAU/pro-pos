import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { hashExchangeCode, randomOpaqueToken } from '@server/lib/crypto';
import { AccessAuthRepository } from '@server/repositories/access-auth-repository';
import { PlatformService } from '@server/services/platform-service';
import { StaffService } from '@server/services/staff-service';
import { AccessAuthService } from '@server/services/access-auth-service';
import { AuthService } from '@server/services/auth-service';

const ORIGIN = 'https://pro-pos.test';
const OWNER_EMAIL = 'owner.test@example.com';

async function seedStore() {
  const platform = new PlatformService(env);
  await platform.bootstrap({
    bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
    email: 'system.admin@example.com',
    displayName: 'System Admin',
  });
  return platform.createStore({
    name: 'Pilot Store',
    ownerDisplayName: 'Pilot Owner',
    ownerEmail: OWNER_EMAIL,
    ownerUsername: 'owner.test',
    ownerPassword: 'OwnerPassword123!',
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

async function authorizeBridge(requestId: string, email: string) {
  const code = randomOpaqueToken();
  const result = await new AccessAuthRepository(env.DB).authorizeRequest({
    id: requestId,
    email,
    subject: `access-${email}`,
    codeHash: await hashExchangeCode(code),
    now: Date.now(),
  });
  expect(result.meta.changes).toBe(1);
  return code;
}

async function completeAccess(
  purpose: 'OWNER_LOGIN' | 'PLATFORM_LOGIN' | 'DEVICE_ACTIVATION',
  email = OWNER_EMAIL,
) {
  const start = await SELF.fetch(`${ORIGIN}/api/v1/auth/access/start`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
  });
  expect(start.status).toBe(200);
  expect(start.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(start.headers.get('Set-Cookie')).toContain('Secure');
  expect(start.headers.get('Set-Cookie')).toContain('SameSite=Lax');
  expect(start.headers.get('Set-Cookie')).toContain('Path=/');
  expect(start.headers.get('Set-Cookie')).not.toContain('Domain=');
  const accessCookie = cookieValue(start, '__Host-propos-access')!;
  const rawState = accessCookie.slice(accessCookie.indexOf('=') + 1);
  const startData = await jsonData<{ loginUrl: string }>(start);
  const requestId = new URL(startData.loginUrl).searchParams.get('request');
  expect(requestId).toBeTruthy();
  const service = new AccessAuthService(env);
  const rawCode = await authorizeBridge(requestId!, email);
  return service.exchange({ rawState, rawCode });
}

describe('Owner and POS activation invariants', () => {
  beforeAll(async () => {
    await seedStore();
  });

  it('logs in Owner using username and password', async () => {
    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'OwnerPassword123!',
      }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('Set-Cookie')).toContain('__Host-propos-session=');
    const data = await jsonData<{
      actor: { kind: string; displayName: string };
      csrfToken: string;
    }>(login);
    expect(data.actor.kind).toBe('OWNER');
    expect(data.actor.displayName).toBe('Pilot Owner');
    expect(data.csrfToken).toBeTruthy();
  });

  it('rejects Owner login with incorrect password', async () => {
    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'WrongPassword!',
      }),
    });
    expect(login.status).toBe(401);
  });

  it('activates POS device directly using Owner username and password', async () => {
    const activate = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/direct`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'OwnerPassword123!',
        deviceName: 'Máy thu ngân trực tiếp',
      }),
    });
    expect(activate.status).toBe(201);
    expect(activate.headers.get('Set-Cookie')).toContain('__Host-propos-device=');
    const data = await jsonData<{ device: { name: string; status: string } }>(activate);
    expect(data.device.name).toBe('Máy thu ngân trực tiếp');
    expect(data.device.status).toBe('ACTIVE');
  });

  it('rejects an Access callback when Cloudflare did not authenticate the request', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/auth/access/complete`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('ACCESS_AUTH_REQUIRED');
  });

  it('creates a SUPER_ADMIN session only for the bootstrapped Access email', async () => {
    const result = await completeAccess('PLATFORM_LOGIN', 'system.admin@example.com');
    expect(result.purpose).toBe('PLATFORM_LOGIN');
    if (result.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform session.');
    const context = await new AuthService(env).context(result.rawSession);
    expect(context.actor?.kind).toBe('SUPER_ADMIN');
  });

  it('returns a failed SUPER_ADMIN callback to the platform login page', async () => {
    const unauthorizedEmail = 'attacker@example.com';
    const start = await SELF.fetch(`${ORIGIN}/api/v1/auth/access/start`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: 'PLATFORM_LOGIN' }),
    });
    expect(start.status).toBe(200);
    const accessCookie = cookieValue(start, '__Host-propos-access')!;
    const startData = await jsonData<{ loginUrl: string }>(start);
    const requestId = new URL(startData.loginUrl).searchParams.get('request');
    const rawCode = await authorizeBridge(requestId!, unauthorizedEmail);

    const complete = await SELF.fetch(
      `${ORIGIN}/api/v1/auth/access/complete?code=${encodeURIComponent(rawCode)}`,
      {
        headers: { Cookie: accessCookie },
        redirect: 'manual',
      },
    );
    expect(complete.status).toBe(303);
    const location = complete.headers.get('Location');
    expect(location).toContain('/platform/login');
    expect(location).toContain('authError=ACCESS_IDENTITY_DENIED');
  });

  it('lets SUPER_ADMIN create and lock a store through the protected API', async () => {
    const result = await completeAccess('PLATFORM_LOGIN', 'system.admin@example.com');
    if (result.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform session.');
    const context = await new AuthService(env).context(result.rawSession);
    const sessionCookie = `__Host-propos-session=${result.rawSession}`;

    const created = await SELF.fetch(`${ORIGIN}/api/v1/platform/stores`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': context.csrfToken!,
      },
      body: JSON.stringify({
        name: 'Store From Platform UI',
        ownerDisplayName: 'Owner From UI',
        ownerEmail: 'owner.ui@example.com',
      }),
    });
    expect(created.status).toBe(201);
    const store = await jsonData<{ storeId: string }>(created);

    const locked = await SELF.fetch(`${ORIGIN}/api/v1/platform/stores/${store.storeId}/status`, {
      method: 'PATCH',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': context.csrfToken!,
      },
      body: JSON.stringify({ status: 'LOCKED' }),
    });
    expect(locked.status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM stores WHERE id = ?')
      .bind(store.storeId)
      .first<{ status: string }>();
    expect(row?.status).toBe('LOCKED');

    const detailsResponse = await SELF.fetch(`${ORIGIN}/api/v1/platform/stores/${store.storeId}`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    expect(detailsResponse.status).toBe(200);
    const details = await jsonData<{
      store: { id: string; name: string; status: string };
      members: Array<{ roleCode: string; displayName: string }>;
      devices: Array<{ name: string }>;
      sessions: Array<{ sessionKind: string }>;
      stats: { totalAreas: number; totalTables: number; totalProducts: number };
    }>(detailsResponse);
    expect(details.store.name).toBe('Store From Platform UI');
    expect(details.members.length).toBeGreaterThanOrEqual(1);
    expect(details.members[0]?.roleCode).toBe('OWNER');
    expect(details.stats).toBeDefined();
  });

  it('allows Owner login on a fresh device without creating a POS device', async () => {
    const beforeCount = await env.DB.prepare('SELECT COUNT(*) AS total FROM devices').first<{
      total: number;
    }>();
    const response = await completeAccess('OWNER_LOGIN');

    expect(response.purpose).toBe('OWNER_LOGIN');
    expect(response).toHaveProperty('rawSession');
    const afterCount = await env.DB.prepare('SELECT COUNT(*) AS total FROM devices').first<{
      total: number;
    }>();
    expect(afterCount?.total).toBe(beforeCount?.total);
  });

  it('activates a POS only after dedicated Owner authorization', async () => {
    const authorize = await completeAccess('DEVICE_ACTIVATION');
    if (authorize.purpose !== 'DEVICE_ACTIVATION') throw new Error('Expected activation grant.');
    const grantCookie = `__Host-propos-activation=${authorize.rawGrant}`;
    const authorizationResponse = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/context`, {
      headers: { Cookie: grantCookie! },
    });
    const authorization = await jsonData<{ csrfToken: string }>(authorizationResponse);

    const confirm = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/confirm`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: grantCookie!,
        'X-CSRF-Token': authorization.csrfToken,
        'Idempotency-Key': 'activate-pilot-pos-001',
      },
      body: JSON.stringify({ deviceName: 'Máy thu ngân chính' }),
    });

    expect(confirm.status).toBe(201);
    expect(confirm.headers.get('Set-Cookie')).toContain('__Host-propos-device=');
    expect(confirm.headers.get('Set-Cookie')).toContain('__Host-propos-session=; Max-Age=0');
    const device = await env.DB.prepare(
      "SELECT id, status FROM devices WHERE name = 'Máy thu ngân chính'",
    ).first<{ id: string; status: string }>();
    expect(device?.status).toBe('ACTIVE');
  });

  it('rejects Employee PIN login without an active device cookie', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/auth/employee/login`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'employee.test',
        pin: '1234',
      }),
    });
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('DEVICE_REQUIRED');
  });

  it('logs an employee in with username and PIN on an ACTIVE device', async () => {
    const store = await env.DB.prepare("SELECT id FROM stores WHERE name = 'Pilot Store'").first<{
      id: string;
    }>();
    await new StaffService(env).createEmployee({
      storeId: store!.id,
      displayName: 'Nhân viên thử nghiệm',
      username: 'employee.test',
      pin: '1234',
      permissionKeys: [],
    });

    const authorize = await completeAccess('DEVICE_ACTIVATION');
    if (authorize.purpose !== 'DEVICE_ACTIVATION') throw new Error('Expected activation grant.');
    const grantCookie = `__Host-propos-activation=${authorize.rawGrant}`;
    const authorizationResponse = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/context`, {
      headers: { Cookie: grantCookie! },
    });
    const authorization = await jsonData<{ csrfToken: string }>(authorizationResponse);
    const confirm = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/confirm`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: grantCookie!,
        'X-CSRF-Token': authorization.csrfToken,
        'Idempotency-Key': 'activate-employee-login-pos',
      },
      body: JSON.stringify({ deviceName: 'Máy nhân viên' }),
    });
    const deviceCookie = cookieValue(confirm, '__Host-propos-device');

    const login = await SELF.fetch(`${ORIGIN}/api/v1/auth/employee/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: deviceCookie!,
      },
      body: JSON.stringify({ username: 'employee.test', pin: '1234' }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('Set-Cookie')).toContain('__Host-propos-session=');
    const payload = await jsonData<{ actor: { kind: string; displayName: string } }>(login);
    expect(payload.actor).toMatchObject({
      kind: 'EMPLOYEE',
      displayName: 'Nhân viên thử nghiệm',
    });
  });

  it('handles GET /api/v1/auth/access/logout by clearing session and redirecting to Access bridge', async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/api/v1/auth/access/logout?returnTo=${encodeURIComponent(`${ORIGIN}/?tab=owner&loggedOut=1`)}`,
      {
        redirect: 'manual',
      },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('/cdn-cgi/access/logout');
    expect(response.headers.get('Location')).toContain(
      encodeURIComponent(
        `/logout-callback?target=${encodeURIComponent(`${ORIGIN}/?tab=owner&loggedOut=1`)}`,
      ),
    );
    expect(response.headers.get('Set-Cookie')).toContain('__Host-propos-session=; Max-Age=0');
  });

  it('returns accessLogoutUrl on POST /api/v1/auth/logout for Owner session', async () => {
    const authorize = await completeAccess('OWNER_LOGIN');
    if (authorize.purpose !== 'OWNER_LOGIN') throw new Error('Expected owner login.');
    const sessionCookie = `__Host-propos-session=${authorize.rawSession}`;
    const context = await new AuthService(env).context(authorize.rawSession);

    const logout = await SELF.fetch(`${ORIGIN}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'X-CSRF-Token': context.csrfToken!,
      },
    });
    expect(logout.status).toBe(200);
    const data = await jsonData<{ loggedOut: boolean; accessLogoutUrl: string | null }>(logout);
    expect(data.loggedOut).toBe(true);
    expect(data.accessLogoutUrl).toContain('/cdn-cgi/access/logout');
    expect(data.accessLogoutUrl).toContain(
      encodeURIComponent(
        `/logout-callback?target=${encodeURIComponent(`${ORIGIN}/?tab=owner&loggedOut=1`)}`,
      ),
    );
    expect(logout.headers.get('Set-Cookie')).toContain('__Host-propos-session=; Max-Age=0');
  });

  it('allows Owner to change password and login with the new password', async () => {
    const loginInitial = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'OwnerPassword123!',
      }),
    });
    expect(loginInitial.status).toBe(200);
    const sessionCookie = cookieValue(loginInitial, '__Host-propos-session')!;
    const initialData = await jsonData<{ csrfToken: string }>(loginInitial);

    const change = await SELF.fetch(`${ORIGIN}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': initialData.csrfToken,
      },
      body: JSON.stringify({
        currentPassword: 'OwnerPassword123!',
        newPassword: 'BrandNewOwnerPassword456!',
      }),
    });
    expect(change.status).toBe(200);

    const loginOld = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'OwnerPassword123!',
      }),
    });
    expect(loginOld.status).toBe(401);

    const loginNew = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'BrandNewOwnerPassword456!',
      }),
    });
    expect(loginNew.status).toBe(200);
  });
});
