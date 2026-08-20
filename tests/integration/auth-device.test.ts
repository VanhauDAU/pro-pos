import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { PlatformService } from '@server/services/platform-service';
import { StaffService } from '@server/services/staff-service';

const ORIGIN = 'https://pro-pos.test';
const OWNER_USERNAME = 'owner.test';
const OWNER_PASSWORD = 'owner-password-long-enough';

async function seedStore() {
  const platform = new PlatformService(env);
  await platform.bootstrap({
    bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
    username: 'system.admin',
    displayName: 'System Admin',
    password: 'system-admin-password-long-enough',
  });
  return platform.createStore({
    name: 'Pilot Store',
    ownerDisplayName: 'Pilot Owner',
    ownerUsername: OWNER_USERNAME,
    ownerPassword: OWNER_PASSWORD,
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

describe('Owner and POS activation invariants', () => {
  beforeAll(async () => {
    await seedStore();
  });

  it('allows Owner login on a fresh device without creating a POS device', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASSWORD }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('__Host-propos-session=');
    expect(response.headers.get('Set-Cookie')).not.toContain('__Host-propos-device=');
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM devices').first<{
      total: number;
    }>();
    expect(count?.total).toBe(0);
  });

  it('activates a POS only after dedicated Owner authorization', async () => {
    const authorize = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/authorize`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASSWORD }),
    });
    expect(authorize.status).toBe(200);
    const grantCookie = cookieValue(authorize, '__Host-propos-activation');
    expect(grantCookie).not.toBeNull();
    expect(authorize.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(authorize.headers.get('Set-Cookie')).toContain('Secure');
    expect(authorize.headers.get('Set-Cookie')).toContain('SameSite=Lax');
    expect(authorize.headers.get('Set-Cookie')).toContain('Path=/');
    expect(authorize.headers.get('Set-Cookie')).not.toContain('Domain=');
    const authorization = await jsonData<{ csrfToken: string }>(authorize);

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

    const authorize = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/authorize`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASSWORD }),
    });
    const grantCookie = cookieValue(authorize, '__Host-propos-activation');
    const authorization = await jsonData<{ csrfToken: string }>(authorize);
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
