import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

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
  return new AccessAuthService(env).complete({
    rawState,
    email,
    subject: `access-${email}`,
  });
}

describe('Owner and POS activation invariants', () => {
  beforeAll(async () => {
    await seedStore();
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
  });

  it('allows Owner login on a fresh device without creating a POS device', async () => {
    const response = await completeAccess('OWNER_LOGIN');

    expect(response.purpose).toBe('OWNER_LOGIN');
    expect(response).toHaveProperty('rawSession');
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM devices').first<{
      total: number;
    }>();
    expect(count?.total).toBe(0);
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
});
