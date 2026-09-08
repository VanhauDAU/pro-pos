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
import type { StoreNotificationOverviewDto } from '@contracts/staff-notifications';

const ORIGIN = 'https://pro-pos.test';
const OWNER_EMAIL = 'notification.owner@example.com';

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

describe('Owner Notification Settings & Active Session Filtering', () => {
  let storeId: string;
  let ownerUserId: string;
  let employee1Id: string;
  let employee2Id: string;
  let ownerCookie: string;
  let ownerCsrfToken: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
      await platform.bootstrap({
        bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
        email: 'system.notifications@example.com',
        displayName: 'System Notification Admin',
        password: 'AdminPassword123!',
      });
    }

    const createdStore = await platform.createStore({
      name: 'Notification Settings Test Store',
      ownerDisplayName: 'Notification Owner',
      ownerEmail: OWNER_EMAIL,
      ownerUsername: 'notification.owner',
      ownerPassword: 'OwnerPassword123!',
    });
    storeId = createdStore.storeId;
    ownerUserId = createdStore.ownerUserId;

    const staffService = new StaffService(env);
    const emp1 = await staffService.createEmployee({
      storeId,
      displayName: 'Nhân viên Thu Ngân',
      username: 'emp.cashier',
      pin: '1234',
      permissionKeys: ['checkout.complete', 'order.create'],
    });
    employee1Id = emp1.userId;

    const emp2 = await staffService.createEmployee({
      storeId,
      displayName: 'Nhân viên Phục Vụ',
      username: 'emp.waiter',
      pin: '5678',
      permissionKeys: ['order.create'],
    });
    employee2Id = emp2.userId;

    // Login as Owner
    const ownerAuth = await completeAccess('OWNER_LOGIN', OWNER_EMAIL);
    if (ownerAuth.purpose !== 'OWNER_LOGIN') throw new Error('Expected owner session');
    ownerCookie = `__Host-propos-session=${ownerAuth.rawSession}`;
    const ownerContext = await new AuthService(env).context(ownerAuth.rawSession);
    ownerCsrfToken = ownerContext.csrfToken!;
  });

  it('retrieves notification settings overview for store staff', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings`, {
      headers: {
        Cookie: ownerCookie,
      },
    });

    expect(res.status).toBe(200);
    const data = await jsonData<StoreNotificationOverviewDto>(res);

    expect(data.totalStaff).toBeGreaterThanOrEqual(3);
    expect(data.items.some((i) => i.userId === employee1Id)).toBe(true);
    expect(data.items.some((i) => i.userId === employee2Id)).toBe(true);
    expect(data.items.some((i) => i.userId === ownerUserId)).toBe(true);

    const emp1Setting = data.items.find((i) => i.userId === employee1Id)!;
    expect(emp1Setting.enabled).toBe(true);
    expect(emp1Setting.onlyActiveSessions).toBe(true);
    expect(emp1Setting.notifyOrderPaid).toBe(true);
    expect(emp1Setting.notifyQrOrder).toBe(true);
    expect(emp1Setting.notifyCallStaff).toBe(true);
    expect(emp1Setting.notifyCheckoutRequest).toBe(true);
    expect(emp1Setting.notifyTableOpenRequest).toBe(true);
    expect(emp1Setting.notifyPrintStatus).toBe(true);
  });

  it('updates notification settings for an individual employee', async () => {
    const updateRes = await SELF.fetch(
      `${ORIGIN}/api/v1/owner/notifications/settings/${employee1Id}`,
      {
        method: 'PUT',
        headers: {
          Origin: ORIGIN,
          Cookie: ownerCookie,
          'X-CSRF-Token': ownerCsrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          onlyActiveSessions: false,
          notifyOrderPaid: true,
          notifyQrOrder: false,
        }),
      },
    );

    expect(updateRes.status).toBe(200);

    const getRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings`, {
      headers: { Cookie: ownerCookie },
    });
    const data = await jsonData<StoreNotificationOverviewDto>(getRes);
    const emp1Setting = data.items.find((i) => i.userId === employee1Id)!;

    expect(emp1Setting.onlyActiveSessions).toBe(false);
    expect(emp1Setting.notifyOrderPaid).toBe(true);
    expect(emp1Setting.notifyQrOrder).toBe(false);
    expect(emp1Setting.notifyCallStaff).toBe(true);
  });

  it('bulk updates notification settings for multiple staff accounts', async () => {
    const bulkRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings/bulk`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: ownerCookie,
        'X-CSRF-Token': ownerCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userIds: [employee1Id, employee2Id],
        settings: {
          onlyActiveSessions: true,
          notifyOrderPaid: false,
        },
      }),
    });

    expect(bulkRes.status).toBe(200);

    const getRes = await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings`, {
      headers: { Cookie: ownerCookie },
    });
    const data = await jsonData<StoreNotificationOverviewDto>(getRes);

    const emp1Setting = data.items.find((i) => i.userId === employee1Id)!;
    const emp2Setting = data.items.find((i) => i.userId === employee2Id)!;

    expect(emp1Setting.onlyActiveSessions).toBe(true);
    expect(emp1Setting.notifyOrderPaid).toBe(false);
    expect(emp2Setting.onlyActiveSessions).toBe(true);
    expect(emp2Setting.notifyOrderPaid).toBe(false);
  });

  it('filters subscriptions accurately by notification kind and active session rule', async () => {
    const pushRepo = new PushSubscriptionRepository(env.DB);
    const now = Date.now();

    // Setup push subscriptions for emp1 and emp2
    await pushRepo.upsert({
      storeId,
      userId: employee1Id,
      deviceId: null,
      endpoint: 'https://fcm.googleapis.com/fcm/send/emp1-token',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A3qcVOkxE-KeyEmp1',
      auth: 'authKeyEmp12345678',
      userAgent: 'Test Agent',
      now,
    });

    await pushRepo.upsert({
      storeId,
      userId: employee2Id,
      deviceId: null,
      endpoint: 'https://fcm.googleapis.com/fcm/send/emp2-token',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A3qcVOkxE-KeyEmp2',
      auth: 'authKeyEmp22345678',
      userAgent: 'Test Agent',
      now,
    });

    // Case 1: Both employees have onlyActiveSessions = 1 and neither has an active session
    // -> Neither should be returned for QR_ORDER
    const eligibleNoSession = await pushRepo.listEligibleSubscriptions(storeId, 'QR_ORDER', now);
    expect(eligibleNoSession.some((s) => s.endpoint.includes('emp1-token'))).toBe(false);
    expect(eligibleNoSession.some((s) => s.endpoint.includes('emp2-token'))).toBe(false);

    // Case 2: Employee 1 sets onlyActiveSessions = 0 (allow notifications without active session)
    // and notifyQrOrder = 1
    await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings/${employee1Id}`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        Cookie: ownerCookie,
        'X-CSRF-Token': ownerCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        onlyActiveSessions: false,
        notifyQrOrder: true,
      }),
    });

    const eligibleEmp1Allowed = await pushRepo.listEligibleSubscriptions(storeId, 'QR_ORDER', now);
    expect(eligibleEmp1Allowed.some((s) => s.endpoint.includes('emp1-token'))).toBe(true);
    expect(eligibleEmp1Allowed.some((s) => s.endpoint.includes('emp2-token'))).toBe(false);

    // Case 3: Employee 1 turns off notifyQrOrder = 0
    await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings/${employee1Id}`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        Cookie: ownerCookie,
        'X-CSRF-Token': ownerCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notifyQrOrder: false,
        notifyOrderPaid: true,
      }),
    });

    // Now QR_ORDER should NOT include emp1
    const eligibleNoQr = await pushRepo.listEligibleSubscriptions(storeId, 'QR_ORDER', now);
    expect(eligibleNoQr.some((s) => s.endpoint.includes('emp1-token'))).toBe(false);

    // But ORDER_PAID should include emp1!
    const eligiblePaid = await pushRepo.listEligibleSubscriptions(storeId, 'ORDER_PAID', now);
    expect(eligiblePaid.some((s) => s.endpoint.includes('emp1-token'))).toBe(true);

    // Case 4: Employee 1 turns off entire notifications (enabled = false)
    await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/settings/${employee1Id}`, {
      method: 'PUT',
      headers: {
        Origin: ORIGIN,
        Cookie: ownerCookie,
        'X-CSRF-Token': ownerCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
      }),
    });

    const eligibleDisabled = await pushRepo.listEligibleSubscriptions(storeId, 'ORDER_PAID', now);
    expect(eligibleDisabled.some((s) => s.endpoint.includes('emp1-token'))).toBe(false);
  });

  it('triggers a test notification via POST /api/v1/owner/notifications/test', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/owner/notifications/test`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: ownerCookie,
        'X-CSRF-Token': ownerCsrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'ORDER_PAID',
      }),
    });

    expect(res.status).toBe(200);
    const data = await jsonData<{ sent: number; disabled: boolean }>(res);
    expect(data).toHaveProperty('sent');
    expect(data).toHaveProperty('disabled');
  });
});
