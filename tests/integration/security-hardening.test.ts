import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { StaffService } from '@server/services/staff-service';
import { AuthRepository } from '@server/repositories/auth-repository';
import { deriveCsrfToken, hashOpaqueToken, randomOpaqueToken } from '@server/lib/crypto';

const ORIGIN = 'https://pro-pos.test';

interface Identity {
  storeId: string;
  ownerUserId: string;
  rawSession: string;
  csrf: string;
}

interface DeviceFixture {
  id: string;
  rawSecret: string;
}

async function ownerIdentity(storeId: string, ownerUserId: string): Promise<Identity> {
  const rawSession = randomOpaqueToken();
  await new AuthRepository(env.DB).createSession({
    id: crypto.randomUUID(),
    tokenHash: await hashOpaqueToken(rawSession, env.SESSION_TOKEN_PEPPER!),
    userId: ownerUserId,
    storeId,
    deviceId: null,
    kind: 'OWNER',
    credentialVersion: 1,
    expiresAt: Date.now() + 3_600_000,
    idleExpiresAt: Date.now() + 3_600_000,
    now: Date.now(),
  });
  return {
    storeId,
    ownerUserId,
    rawSession,
    csrf: await deriveCsrfToken(rawSession, env.AUTH_PEPPER!),
  };
}

async function activeDevice(
  storeId: string,
  ownerUserId: string,
  name: string,
): Promise<DeviceFixture> {
  const id = crypto.randomUUID();
  const rawSecret = randomOpaqueToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO devices (
        id, store_id, name, status, activated_by, activated_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
    ).bind(id, storeId, name, ownerUserId, now, now, now),
    env.DB.prepare(
      `INSERT INTO device_credentials (
        device_id, secret_hash, pepper_version, credential_version, issued_at, expires_at
      ) VALUES (?, ?, 1, 1, ?, ?)`,
    ).bind(id, await hashOpaqueToken(rawSecret, env.DEVICE_TOKEN_PEPPER!), now, now + 86_400_000),
  ]);
  return { id, rawSecret };
}

function ownerHeaders(identity: Identity, device?: DeviceFixture) {
  const cookies = [`__Host-propos-session=${identity.rawSession}`];
  if (device) cookies.push(`__Host-propos-device=${device.rawSecret}`);
  return {
    Origin: ORIGIN,
    Cookie: cookies.join('; '),
    'Content-Type': 'application/json',
    'X-CSRF-Token': identity.csrf,
  };
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe('PRO-010A API security and tenant boundaries', () => {
  let storeA: Identity;
  let storeB: Identity;
  let deviceA: DeviceFixture;
  let deviceB: DeviceFixture;
  let employeeId: string;
  let employeeSession: string;
  let employeeCsrf: string;
  let productId: string;
  let variantId: string;
  let orderId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'security.admin@example.com',
      displayName: 'Security Admin',
    });
    const a = await platform.createStore({
      name: 'Security Store A',
      ownerDisplayName: 'Owner A',
      ownerEmail: 'security.owner.a@example.com',
    });
    const b = await platform.createStore({
      name: 'Security Store B',
      ownerDisplayName: 'Owner B',
      ownerEmail: 'security.owner.b@example.com',
    });
    storeA = await ownerIdentity(a.storeId, a.ownerUserId);
    storeB = await ownerIdentity(b.storeId, b.ownerUserId);
    deviceA = await activeDevice(a.storeId, a.ownerUserId, 'Device A');
    deviceB = await activeDevice(b.storeId, b.ownerUserId, 'Device B');

    const staff = new StaffService(env);
    ({ userId: employeeId } = await staff.createEmployee({
      storeId: a.storeId,
      displayName: 'Order-only employee',
      username: 'order.only',
      pin: '1234',
      permissionKeys: ['order.manage'],
    }));
    employeeSession = randomOpaqueToken();
    await new AuthRepository(env.DB).createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(employeeSession, env.SESSION_TOKEN_PEPPER!),
      userId: employeeId,
      storeId: a.storeId,
      deviceId: deviceA.id,
      kind: 'EMPLOYEE',
      credentialVersion: 1,
      expiresAt: Date.now() + 3_600_000,
      idleExpiresAt: Date.now() + 3_600_000,
      now: Date.now(),
    });
    employeeCsrf = await deriveCsrfToken(employeeSession, env.AUTH_PEPPER!);

    const catalog = new CatalogService(env);
    const area = await catalog.createNamed(a.storeId, 'areas', 'API Area');
    const unit = await catalog.createNamed(a.storeId, 'units', 'API Unit');
    const time = await catalog.createProduct(a.storeId, {
      name: 'API Time',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(a.storeId, {
      productId: time.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 0,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const table = await catalog.createTable({
      storeId: a.storeId,
      areaId: area.id,
      timeProductId: time.id,
      name: 'API Table',
      sortOrder: 1,
    });
    const product = await catalog.createProduct(a.storeId, {
      name: 'API Product',
      productType: 'QUANTITY',
      unitId: unit.id,
      variants: [
        {
          name: 'Default',
          salePriceVnd: 100_000,
          costPriceVnd: 0,
          promptPrice: false,
        },
      ],
    });
    productId = product.id;
    variantId = (await env.DB.prepare('SELECT id FROM product_variants WHERE product_id = ?')
      .bind(productId)
      .first<{ id: string }>())!.id;
    orderId = (
      await new PosService(env).openTable({
        storeId: a.storeId,
        actorId: a.ownerUserId,
        requestId: 'security-open-order',
        idempotencyKey: 'security-open-order-key',
        tableId: table.id,
        expectedTableVersion: 1,
      })
    ).orderId;
  });

  it('revokes the current device only when actor and device belong to the same store', async () => {
    const sameStore = await SELF.fetch(`${ORIGIN}/api/v1/devices/current/revoke`, {
      method: 'POST',
      headers: ownerHeaders(storeA, deviceA),
    });
    expect(sameStore.status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(deviceA.id)
      .first<{ status: string }>();
    expect(row?.status).toBe('REVOKED');
    const revokeAudit = await env.DB.prepare(
      `SELECT actor_user_id AS actorUserId, device_id AS deviceId, request_id AS requestId
       FROM audit_logs
       WHERE store_id = ? AND action = 'DEVICE_REVOKED' AND entity_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(storeA.storeId, deviceA.id)
      .first<{ actorUserId: string; deviceId: string; requestId: string }>();
    expect(revokeAudit).toMatchObject({
      actorUserId: storeA.ownerUserId,
      deviceId: deviceA.id,
      requestId: expect.any(String),
    });

    deviceA = await activeDevice(storeA.storeId, storeA.ownerUserId, 'Device A replacement');
    await env.DB.prepare(
      `UPDATE auth_sessions SET device_id = ?, status = 'ACTIVE', revoked_at = NULL
       WHERE user_id = ? AND session_kind = 'EMPLOYEE'`,
    )
      .bind(deviceA.id, employeeId)
      .run();
    const crossStore = await SELF.fetch(`${ORIGIN}/api/v1/devices/current/revoke`, {
      method: 'POST',
      headers: ownerHeaders(storeA, deviceB),
    });
    expect(crossStore.status).toBe(403);
    expect(await errorCode(crossStore)).toBe('TENANT_BOUNDARY_VIOLATION');
    const untouched = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(deviceB.id)
      .first<{ status: string }>();
    expect(untouched?.status).toBe('ACTIVE');
  });

  it('does not revoke a remote device credential through the owner device route', async () => {
    const remoteStaff = await new StaffService(env).createEmployee({
      storeId: storeB.storeId,
      displayName: 'Remote device employee',
      username: 'remote.device.employee',
      pin: '1234',
      permissionKeys: ['order.manage'],
    });
    await new AuthRepository(env.DB).createSession({
      id: crypto.randomUUID(),
      tokenHash: await hashOpaqueToken(randomOpaqueToken(), env.SESSION_TOKEN_PEPPER!),
      userId: remoteStaff.userId,
      storeId: storeB.storeId,
      deviceId: deviceB.id,
      kind: 'EMPLOYEE',
      credentialVersion: 1,
      expiresAt: Date.now() + 3_600_000,
      idleExpiresAt: Date.now() + 3_600_000,
      now: Date.now(),
    });
    const response = await SELF.fetch(`${ORIGIN}/api/v1/owner/devices/${deviceB.id}/revoke`, {
      method: 'POST',
      headers: ownerHeaders(storeA),
    });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('DEVICE_NOT_FOUND');

    const remoteDevice = await env.DB.prepare('SELECT status FROM devices WHERE id = ?')
      .bind(deviceB.id)
      .first<{ status: string }>();
    const remoteCredential = await env.DB.prepare(
      'SELECT revoked_at AS revokedAt FROM device_credentials WHERE device_id = ?',
    )
      .bind(deviceB.id)
      .first<{ revokedAt: number | null }>();
    const remoteSession = await env.DB.prepare(
      `SELECT status FROM auth_sessions WHERE device_id = ? AND user_id = ? LIMIT 1`,
    )
      .bind(deviceB.id, remoteStaff.userId)
      .first<{ status: string }>();
    expect(remoteDevice?.status).toBe('ACTIVE');
    expect(remoteCredential?.revokedAt).toBeNull();
    expect(remoteSession?.status).toBe('ACTIVE');
  });

  it('requires discount.apply only when the add-item request contains a discount', async () => {
    const employeeHeaders = {
      Origin: ORIGIN,
      Cookie: `__Host-propos-session=${employeeSession}; __Host-propos-device=${deviceA.rawSecret}`,
      'Content-Type': 'application/json',
      'X-CSRF-Token': employeeCsrf,
      'Idempotency-Key': 'employee-no-discount-001',
    };
    const add = await SELF.fetch(`${ORIGIN}/api/v1/pos/orders/${orderId}/items`, {
      method: 'POST',
      headers: employeeHeaders,
      body: JSON.stringify({
        productId,
        variantId,
        quantityMilli: 1000,
        expectedOrderVersion: 1,
      }),
    });
    expect(add.status).toBe(201);

    const deniedDiscountResponses = await Promise.all(
      [
        { type: 'FIXED', value: 10_000, reason: 'Kiểm tra quyền' },
        { type: 'PERCENT', value: 10, reason: 'Kiểm tra quyền' },
      ].map((discount) =>
        SELF.fetch(`${ORIGIN}/api/v1/pos/orders/${orderId}/items`, {
          method: 'POST',
          headers: { ...employeeHeaders, 'Idempotency-Key': `denied-${discount.type}` },
          body: JSON.stringify({
            productId,
            variantId,
            quantityMilli: 1000,
            expectedOrderVersion: 2,
            discount,
          }),
        }),
      ),
    );
    expect(deniedDiscountResponses.map((response) => response.status)).toEqual([403, 403]);
    expect(await Promise.all(deniedDiscountResponses.map(errorCode))).toEqual([
      'PERMISSION_DENIED',
      'PERMISSION_DENIED',
    ]);

    const role = await env.DB.prepare(
      'SELECT role_id AS roleId FROM store_memberships WHERE store_id = ? AND user_id = ?',
    )
      .bind(storeA.storeId, employeeId)
      .first<{ roleId: string }>();
    await env.DB.prepare(
      `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
       VALUES (?, ?, 'discount.item', ?)`,
    )
      .bind(storeA.storeId, role!.roleId, Date.now())
      .run();
    const allowed = await SELF.fetch(`${ORIGIN}/api/v1/pos/orders/${orderId}/items`, {
      method: 'POST',
      headers: { ...employeeHeaders, 'Idempotency-Key': 'employee-discount-allowed' },
      body: JSON.stringify({
        productId,
        variantId,
        quantityMilli: 1000,
        expectedOrderVersion: 2,
        discount: { type: 'FIXED', value: 10_000, reason: 'Khách quen' },
      }),
    });
    expect(allowed.status).toBe(201);

    const ownerAdd = await SELF.fetch(`${ORIGIN}/api/v1/pos/orders/${orderId}/items`, {
      method: 'POST',
      headers: { ...ownerHeaders(storeA), 'Idempotency-Key': 'owner-discount-allowed' },
      body: JSON.stringify({
        productId,
        variantId,
        quantityMilli: 1000,
        expectedOrderVersion: 3,
        discount: { type: 'PERCENT', value: 10, reason: 'Ưu đãi chủ quán' },
      }),
    });
    expect(ownerAdd.status).toBe(201);
  });

  it('enforces report.revenue on the revenue report API', async () => {
    const headers = {
      Origin: ORIGIN,
      Cookie: `__Host-propos-session=${employeeSession}; __Host-propos-device=${deviceA.rawSecret}`,
    };
    const denied = await SELF.fetch(
      `${ORIGIN}/api/v1/owner/analytics/reports/revenue?timeRange=today`,
      { headers },
    );
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe('PERMISSION_DENIED');

    const role = await env.DB.prepare(
      'SELECT role_id AS roleId FROM store_memberships WHERE store_id = ? AND user_id = ?',
    )
      .bind(storeA.storeId, employeeId)
      .first<{ roleId: string }>();
    await env.DB.prepare(
      `INSERT INTO role_permissions (store_id, role_id, permission_key, created_at)
       VALUES (?, ?, 'report.revenue', ?), (?, ?, 'report.revenue.print', ?)`,
    )
      .bind(storeA.storeId, role!.roleId, Date.now(), storeA.storeId, role!.roleId, Date.now())
      .run();

    const allowed = await SELF.fetch(
      `${ORIGIN}/api/v1/owner/analytics/reports/revenue?timeRange=today`,
      { headers },
    );
    expect(allowed.status).toBe(200);
    const payload = (await allowed.json()) as {
      data: {
        summary: { netRevenue: number };
        paymentMethods: unknown[];
        orderTypes: unknown[];
        staffRevenue: unknown[];
        staffOptions: unknown[];
        cancellations: unknown[];
      };
    };
    expect(payload.data.summary.netRevenue).toBeGreaterThanOrEqual(0);
    expect(payload.data).toMatchObject({
      paymentMethods: [],
      orderTypes: [],
      staffRevenue: [],
      staffOptions: [],
      cancellations: [],
    });
    const paymentDenied = await SELF.fetch(
      `${ORIGIN}/api/v1/owner/analytics/reports/revenue?reportType=PAYMENT_METHOD&timeRange=today`,
      { headers },
    );
    expect(paymentDenied.status).toBe(403);
    expect(await errorCode(paymentDenied)).toBe('PERMISSION_DENIED');

    const printIdempotencyKey = `security-revenue-report:${crypto.randomUUID()}`;
    const queued = await SELF.fetch(`${ORIGIN}/api/v1/owner/analytics/reports/revenue/print`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'X-CSRF-Token': employeeCsrf,
        'Idempotency-Key': printIdempotencyKey,
      },
      body: JSON.stringify({
        timeRange: 'today',
        hourMode: 'all',
        fromHour: 0,
        fromMinute: 0,
        toHour: 0,
        toMinute: 0,
        idempotencyKey: printIdempotencyKey,
      }),
    });
    expect(queued.status).toBe(201);
    const queuedPayload = (await queued.json()) as { data: { jobId: string } };
    expect(queuedPayload.data.jobId).toEqual(expect.any(String));

    const bypass = await SELF.fetch(`${ORIGIN}/api/v1/pos/print-jobs`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'X-CSRF-Token': employeeCsrf,
        'Idempotency-Key': `direct-revenue-report:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        documentType: 'revenue_report',
        documentId: 'not-a-public-print-document',
        printerRole: 'receipt',
        idempotencyKey: `direct-revenue-report:${crypto.randomUUID()}`,
      }),
    });
    expect(bypass.status).toBe(422);
  });

  it('rejects cross-store catalog, bank QR and table references without fake 201 responses', async () => {
    const catalog = new CatalogService(env);
    const categoryB = await catalog.createNamed(storeB.storeId, 'categories', 'Category B');
    const unitB = await catalog.createNamed(storeB.storeId, 'units', 'Unit B');
    const areaB = await catalog.createNamed(storeB.storeId, 'areas', 'Area B');
    const nonTimeB = await catalog.createProduct(storeB.storeId, {
      name: 'Not Time B',
      productType: 'QUANTITY',
      unitId: unitB.id,
      variants: [{ name: 'Default', salePriceVnd: 1_000, costPriceVnd: 0, promptPrice: false }],
    });

    const product = await SELF.fetch(`${ORIGIN}/api/v1/owner/catalog/products`, {
      method: 'POST',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({
        name: 'Cross store product',
        productType: 'QUANTITY',
        categoryId: categoryB.id,
        unitId: unitB.id,
        variants: [{ name: 'Default', salePriceVnd: 10_000, costPriceVnd: 0, promptPrice: false }],
      }),
    });
    expect(product.status).toBe(404);

    const table = await SELF.fetch(`${ORIGIN}/api/v1/owner/catalog/tables`, {
      method: 'POST',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({ areaId: areaB.id, timeProductId: nonTimeB.id, name: 'Fake table' }),
    });
    expect(table.status).toBe(422);
    const fake = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM service_tables WHERE name = 'Fake table'",
    ).first<{ total: number }>();
    expect(fake?.total).toBe(0);

    const mediaId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO media_objects (
        id, store_id, object_key, mime_type, byte_size, status, created_by, created_at
      ) VALUES (?, ?, ?, 'image/png', 1, 'ACTIVE', ?, ?)`,
    )
      .bind(
        mediaId,
        storeB.storeId,
        `stores/${storeB.storeId}/media/cross.png`,
        storeB.ownerUserId,
        Date.now(),
      )
      .run();
    const settings = await SELF.fetch(`${ORIGIN}/api/v1/owner/store/settings`, {
      method: 'PUT',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({
        name: 'Security Store A',
        address: 'Store A address',
        businessDayCutoffMinutes: 0,
        bankQrMediaId: mediaId,
      }),
    });
    expect(settings.status).toBe(404);

    const invalidPhoneSettings = await SELF.fetch(`${ORIGIN}/api/v1/owner/store/settings`, {
      method: 'PUT',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({
        name: 'Security Store A',
        phone: '0912abc456',
        address: 'Số 1 đường Test, Đà Nẵng',
        businessDayCutoffMinutes: 0,
      }),
    });
    expect(invalidPhoneSettings.status).toBe(422);
    expect(await errorCode(invalidPhoneSettings)).toBe('VALIDATION_ERROR');

    const updatedSettings = await SELF.fetch(`${ORIGIN}/api/v1/owner/store/settings`, {
      method: 'PUT',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({
        name: 'Security Store A',
        phone: '0912345678',
        address: 'Số 1 đường Test, Đà Nẵng',
        businessDayCutoffMinutes: 0,
        provinceCode: 48,
        provinceName: 'Thành phố Đà Nẵng',
        wardCode: 12345,
        wardName: 'Phường Hải Châu',
      }),
    });
    expect(updatedSettings.status).toBe(200);
    const storedLocation = await env.DB.prepare(
      `SELECT phone, province_code AS provinceCode, province_name AS provinceName,
              ward_code AS wardCode, ward_name AS wardName
       FROM store_settings WHERE store_id = ?`,
    )
      .bind(storeA.storeId)
      .first<{
        provinceCode: number;
        provinceName: string;
        wardCode: number;
        wardName: string;
      }>();
    expect(storedLocation).toMatchObject({
      phone: '0912345678',
      provinceCode: 48,
      provinceName: 'Thành phố Đà Nẵng',
      wardCode: 12345,
      wardName: 'Phường Hải Châu',
    });
  });

  it('keeps bank account mutations tenant-local', async () => {
    const created = await SELF.fetch(`${ORIGIN}/api/v1/owner/store/bank-accounts`, {
      method: 'POST',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({
        bankBin: '970422',
        bankCode: 'MB',
        bankName: 'Ngân hàng TMCP Quân đội',
        accountNumber: '999999999',
        accountName: 'STORE A',
        isDefault: true,
      }),
    });
    expect(created.status).toBe(201);
    const bankAccountId = ((await created.json()) as { data: { bankAccount: { id: string } } }).data
      .bankAccount.id;

    const crossStoreUpdate = await SELF.fetch(
      `${ORIGIN}/api/v1/owner/store/bank-accounts/${bankAccountId}`,
      {
        method: 'PATCH',
        headers: ownerHeaders(storeB),
        body: JSON.stringify({
          bankBin: '970436',
          bankCode: 'VCB',
          bankName: 'Ngân hàng TMCP Ngoại thương Việt Nam',
          accountNumber: '111111111',
          accountName: 'STORE B',
          isDefault: true,
        }),
      },
    );
    expect(crossStoreUpdate.status).toBe(404);
    expect(await errorCode(crossStoreUpdate)).toBe('BANK_ACCOUNT_NOT_FOUND');

    const crossStoreDelete = await SELF.fetch(
      `${ORIGIN}/api/v1/owner/store/bank-accounts/${bankAccountId}`,
      { method: 'DELETE', headers: ownerHeaders(storeB) },
    );
    expect(crossStoreDelete.status).toBe(404);
    const account = await env.DB.prepare(
      `SELECT status FROM store_bank_accounts WHERE store_id = ? AND id = ?`,
    )
      .bind(storeA.storeId, bankAccountId)
      .first<{ status: string }>();
    expect(account?.status).toBe('ACTIVE');
  });

  it('protects Owners from staff status API and enforces one-user-one-store', async () => {
    const ownerTargetResponses = await Promise.all(
      [storeA.ownerUserId, storeB.ownerUserId, crypto.randomUUID()].map((target) =>
        SELF.fetch(`${ORIGIN}/api/v1/owner/staff/${target}/status`, {
          method: 'PATCH',
          headers: ownerHeaders(storeA),
          body: JSON.stringify({ status: 'DISABLED' }),
        }),
      ),
    );
    expect(ownerTargetResponses.map((response) => response.status)).toEqual([404, 404, 404]);
    expect(await Promise.all(ownerTargetResponses.map(errorCode))).toEqual([
      'EMPLOYEE_NOT_FOUND',
      'EMPLOYEE_NOT_FOUND',
      'EMPLOYEE_NOT_FOUND',
    ]);
    const ownerStatus = await env.DB.prepare('SELECT status FROM users WHERE id = ?')
      .bind(storeA.ownerUserId)
      .first<{ status: string }>();
    expect(ownerStatus?.status).toBe('ACTIVE');

    const employeeStatus = await SELF.fetch(`${ORIGIN}/api/v1/owner/staff/${employeeId}/status`, {
      method: 'PATCH',
      headers: ownerHeaders(storeA),
      body: JSON.stringify({ status: 'DISABLED' }),
    });
    expect(employeeStatus.status).toBe(200);

    const roleB = await env.DB.prepare(
      "SELECT id FROM roles WHERE store_id = ? AND code = 'EMPLOYEE'",
    )
      .bind(storeB.storeId)
      .first<{ id: string }>();
    await expect(
      env.DB.prepare(
        `INSERT INTO store_memberships (
          id, store_id, user_id, role_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
        .bind(crypto.randomUUID(), storeB.storeId, employeeId, roleB!.id, Date.now(), Date.now())
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/u);
  });
});
