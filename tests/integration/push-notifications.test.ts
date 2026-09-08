import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { hashExchangeCode, randomOpaqueToken } from '@server/lib/crypto';
import { AccessAuthRepository } from '@server/repositories/access-auth-repository';
import { PlatformRepository } from '@server/repositories/platform-repository';
import { PlatformService } from '@server/services/platform-service';
import { StaffService } from '@server/services/staff-service';
import { AccessAuthService } from '@server/services/access-auth-service';
import { AuthService } from '@server/services/auth-service';
import { PushSubscriptionRepository } from '@server/repositories/push-subscription-repository';

const ORIGIN = 'https://pro-pos.test';
const OWNER_EMAIL = 'push.owner@example.com';

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
  const accessCookie = cookieValue(start, '__Host-propos-access')!;
  const rawState = accessCookie.slice(accessCookie.indexOf('=') + 1);
  const startData = await jsonData<{ loginUrl: string }>(start);
  const requestId = new URL(startData.loginUrl).searchParams.get('request');
  expect(requestId).toBeTruthy();
  const service = new AccessAuthService(env);
  const rawCode = await authorizeBridge(requestId!, email);
  return service.exchange({ rawState, rawCode });
}

async function completeDeviceActivation(email: string) {
  const authorize = await completeAccess('DEVICE_ACTIVATION', email);
  if (authorize.purpose !== 'DEVICE_ACTIVATION') throw new Error('Expected activation grant.');
  const grantCookie = `__Host-propos-activation=${authorize.rawGrant}`;

  const contextRes = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/context`, {
    headers: { Cookie: grantCookie },
  });
  const context = await jsonData<{ csrfToken: string }>(contextRes);

  const confirmRes = await SELF.fetch(`${ORIGIN}/api/v1/device-activations/confirm`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Cookie: grantCookie,
      'X-CSRF-Token': context.csrfToken,
      'Idempotency-Key': 'activate-device-for-push-tests',
    },
    body: JSON.stringify({ deviceName: 'Thiết bị POS Push' }),
  });
  expect(confirmRes.status).toBe(201);
  return cookieValue(confirmRes, '__Host-propos-device')!;
}

describe('POS Push Notifications without unnecessary table.view permission', () => {
  let storeId: string;
  let employeeUserId: string;
  let deviceCookie: string;
  let sessionCookie: string;
  let csrfToken: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
      await platform.bootstrap({
        bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
        email: 'system.push@example.com',
        displayName: 'System Push Admin',
        password: 'AdminPassword123!',
      });
    }

    const createdStore = await platform.createStore({
      name: 'Push Notification Test Store',
      ownerDisplayName: 'Push Owner',
      ownerEmail: OWNER_EMAIL,
      ownerUsername: 'push.owner',
      ownerPassword: 'OwnerPassword123!',
    });
    storeId = createdStore.storeId;

    const staffService = new StaffService(env);
    const employee = await staffService.createEmployee({
      storeId,
      displayName: 'Nhân viên không quyền bàn',
      username: 'employee.noperm',
      pin: '5678',
      permissionKeys: [],
    });
    employeeUserId = employee.userId;

    deviceCookie = await completeDeviceActivation(OWNER_EMAIL);

    const loginRes = await SELF.fetch(`${ORIGIN}/api/v1/auth/employee/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: deviceCookie,
      },
      body: JSON.stringify({ username: 'employee.noperm', pin: '5678' }),
    });
    expect(loginRes.status).toBe(200);
    sessionCookie = cookieValue(loginRes, '__Host-propos-session')!;

    const authContextRes = await SELF.fetch(`${ORIGIN}/api/v1/auth/context`, {
      headers: {
        Cookie: `${deviceCookie}; ${sessionCookie}`,
      },
    });
    const authContext = await jsonData<{ csrfToken: string }>(authContextRes);
    csrfToken = authContext.csrfToken;
  });

  it('allows employee to retrieve VAPID public key without table.view permission', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/pos/push/public-key`, {
      headers: {
        Cookie: `${deviceCookie}; ${sessionCookie}`,
      },
    });

    expect(response.status).toBe(200);
    const body = await jsonData<{ publicKey: string }>(response);
    expect(body.publicKey).toBe('test-vapid-public-key');
  });

  it('allows employee to subscribe to push notifications without table.view permission', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/pos/push/subscriptions`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: `${deviceCookie}; ${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-token-123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A3qcVOkxE-TestKeyP256dh',
          auth: 'tH8TestAuthKey12345678',
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await jsonData<{ subscribed: boolean }>(response);
    expect(body.subscribed).toBe(true);

    const saved = await env.DB.prepare(
      'SELECT store_id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    )
      .bind(employeeUserId)
      .first<{
        store_id: string;
        user_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }>();

    expect(saved).toMatchObject({
      store_id: storeId,
      user_id: employeeUserId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-token-123',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A3qcVOkxE-TestKeyP256dh',
      auth: 'tH8TestAuthKey12345678',
    });
  });

  it('lists active store device subscriptions only when staff has an active session', async () => {
    const pushRepo = new PushSubscriptionRepository(env.DB);
    const now = Date.now();

    // With active employee session
    const activeSubs = await pushRepo.listActiveStoreDeviceSubscriptions(storeId, now);
    expect(activeSubs.length).toBeGreaterThanOrEqual(1);
    expect(
      activeSubs.some(
        (sub) => sub.endpoint === 'https://fcm.googleapis.com/fcm/send/test-sub-token-123',
      ),
    ).toBe(true);

    // Filtered when excludeDeviceId is provided
    const deviceRow = await env.DB.prepare(
      'SELECT device_id FROM push_subscriptions WHERE endpoint = ?',
    )
      .bind('https://fcm.googleapis.com/fcm/send/test-sub-token-123')
      .first<{ device_id: string | null }>();

    if (deviceRow?.device_id) {
      const excludedSubs = await pushRepo.listActiveStoreDeviceSubscriptions(
        storeId,
        now,
        deviceRow.device_id,
      );
      expect(
        excludedSubs.some(
          (sub) => sub.endpoint === 'https://fcm.googleapis.com/fcm/send/test-sub-token-123',
        ),
      ).toBe(false);
    }

    // In the future when sessions are expired
    const farFuture = now + 365 * 24 * 60 * 60 * 1000;
    const futureSubs = await pushRepo.listActiveStoreDeviceSubscriptions(storeId, farFuture);
    expect(
      futureSubs.some(
        (sub) => sub.endpoint === 'https://fcm.googleapis.com/fcm/send/test-sub-token-123',
      ),
    ).toBe(false);
  });

  it('allows employee to unsubscribe from push notifications via DELETE /subscriptions', async () => {
    // Check that device has pushNotificationEnabled in store details before unsubscribe
    const platform = new PlatformService(env);
    const storeDetailsBefore = await platform.getStoreDetails(storeId);
    expect(storeDetailsBefore.devices.some((d) => d.pushNotificationEnabled)).toBe(true);

    const deleteResponse = await SELF.fetch(`${ORIGIN}/api/v1/pos/push/subscriptions`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: `${deviceCookie}; ${sessionCookie}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-token-123',
      }),
    });

    expect(deleteResponse.status).toBe(200);
    const body = await jsonData<{ unsubscribed: boolean }>(deleteResponse);
    expect(body.unsubscribed).toBe(true);

    // Verify it is removed from DB
    const remaining = await env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
      .bind('https://fcm.googleapis.com/fcm/send/test-sub-token-123')
      .first<{ id: string }>();
    expect(remaining).toBeNull();

    // Verify store details now reflects pushNotificationEnabled: false
    const storeDetailsAfter = await platform.getStoreDetails(storeId);
    expect(storeDetailsAfter.devices.some((d) => d.pushNotificationEnabled)).toBe(false);
  });

  it('allows SUPER_ADMIN to request push notification prompt on a POS device', async () => {
    const admin = await completeAccess('PLATFORM_LOGIN', 'system.push@example.com');
    if (admin.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform session.');
    const adminContext = await new AuthService(env).context(admin.rawSession);
    const adminSessionCookie = `__Host-propos-session=${admin.rawSession}`;

    const storeDetails = await new PlatformService(env).getStoreDetails(storeId);
    const targetDevice = storeDetails.devices[0];
    if (!targetDevice) throw new Error('Expected at least one device in store details.');
    expect(targetDevice).toBeDefined();

    const response = await SELF.fetch(
      `${ORIGIN}/api/v1/platform/stores/${storeId}/devices/${targetDevice.id}/request-push-prompt`,
      {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Cookie: adminSessionCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': adminContext.csrfToken!,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = await jsonData<{ requested: boolean; deliveredConnections: number }>(response);
    expect(body.requested).toBe(true);
    expect(typeof body.deliveredConnections).toBe('number');
  });
});
