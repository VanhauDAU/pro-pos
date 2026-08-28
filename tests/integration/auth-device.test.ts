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

const ORIGIN = 'https://pro-pos.test';
const OWNER_EMAIL = 'owner.test@example.com';

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

  it('rate-limits Owner password failures per Cloudflare client instead of globally', async () => {
    const wrongPasswordRequest = () =>
      SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.10',
        },
        body: JSON.stringify({
          username: 'owner.test',
          password: 'WrongPassword!',
        }),
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- Login attempts must finish sequentially.
      expect((await wrongPasswordRequest()).status).toBe(401);
    }

    const locked = await wrongPasswordRequest();
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);

    const otherClient = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.11',
      },
      body: JSON.stringify({
        username: 'owner.test',
        password: 'OwnerPassword123!',
      }),
    });
    expect(otherClient.status).toBe(200);
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

    const deviceCookie = cookieValue(activate, '__Host-propos-device')!;
    const contextRes = await SELF.fetch(`${ORIGIN}/api/v1/auth/context`, {
      headers: { Cookie: deviceCookie },
    });
    expect(contextRes.status).toBe(200);
    const contextData = await jsonData<{
      device: { name: string; status: string; storeName: string };
    }>(contextRes);
    expect(contextData.device.storeName).toBe('Pilot Store');

    const disconnectRes = await SELF.fetch(`${ORIGIN}/api/v1/auth/device/disconnect`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Cookie: deviceCookie,
      },
      body: JSON.stringify({}),
    });
    expect(disconnectRes.status).toBe(200);
    expect(disconnectRes.headers.get('Set-Cookie')).toContain('__Host-propos-device=');
    expect(disconnectRes.headers.get('Set-Cookie')).toContain('Max-Age=0');
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

    // Now DELETE the store
    const deleted = await SELF.fetch(`${ORIGIN}/api/v1/platform/stores/${store.storeId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'X-CSRF-Token': context.csrfToken!,
      },
    });
    expect(deleted.status).toBe(200);

    const storeRow = await env.DB.prepare('SELECT id FROM stores WHERE id = ?')
      .bind(store.storeId)
      .first();
    expect(storeRow).toBeNull();

    const memberRow = await env.DB.prepare('SELECT id FROM store_memberships WHERE store_id = ?')
      .bind(store.storeId)
      .first();
    expect(memberRow).toBeNull();

    const roleRow = await env.DB.prepare('SELECT id FROM roles WHERE store_id = ?')
      .bind(store.storeId)
      .first();
    expect(roleRow).toBeNull();

    const deletedDetails = await SELF.fetch(`${ORIGIN}/api/v1/platform/stores/${store.storeId}`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    expect(deletedDetails.status).toBe(404);
  });

  it('lets SUPER_ADMIN delete a fully populated store with GMV, invoices, payments, tables and customers', async () => {
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
        name: 'Busy Coffee Store',
        ownerDisplayName: 'Store Owner',
        ownerEmail: 'busy.owner@example.com',
      }),
    });
    expect(created.status).toBe(201);
    const { storeId } = await jsonData<{ storeId: string }>(created);

    const now = Date.now();
    const areaId = `area-${Math.random().toString(36).slice(2, 8)}`;
    const tableId = `tbl-${Math.random().toString(36).slice(2, 8)}`;
    const prodId = `prd-${Math.random().toString(36).slice(2, 8)}`;
    const timeProdId = `tprd-${Math.random().toString(36).slice(2, 8)}`;
    const varId = `var-${Math.random().toString(36).slice(2, 8)}`;
    const orderId = `ord-${Math.random().toString(36).slice(2, 8)}`;
    const invoiceId = `inv-${Math.random().toString(36).slice(2, 8)}`;
    const paymentId = `pay-${Math.random().toString(36).slice(2, 8)}`;
    const bankAccId = `bank-${Math.random().toString(36).slice(2, 8)}`;
    const customerId = `cust-${Math.random().toString(36).slice(2, 8)}`;
    const custGroupId = `cgrp-${Math.random().toString(36).slice(2, 8)}`;
    const promoId = `prm-${Math.random().toString(36).slice(2, 8)}`;
    const batchId = `cbat-${Math.random().toString(36).slice(2, 8)}`;

    const ownerUser = await env.DB.prepare(
      `SELECT user_id AS id FROM store_memberships WHERE store_id = ? LIMIT 1`,
    )
      .bind(storeId)
      .first<{ id: string }>();

    // Seed populated store data
    await env.DB.prepare(
      `INSERT INTO store_bank_accounts (id, store_id, bank_bin, bank_code, bank_name, account_number, account_name, is_default, status, created_at, updated_at)
       VALUES (?, ?, '970436', 'VCB', 'Vietcombank', '0123456789', 'OWNER', 1, 'ACTIVE', ?, ?)`,
    )
      .bind(bankAccId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO areas (id, store_id, name, status, created_at, updated_at) VALUES (?, ?, 'Khu A', 'ACTIVE', ?, ?)`,
    )
      .bind(areaId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO products (id, store_id, name, product_type, status, created_at, updated_at) VALUES (?, ?, 'Cà phê', 'QUANTITY', 'ACTIVE', ?, ?)`,
    )
      .bind(prodId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO products (id, store_id, name, product_type, status, created_at, updated_at) VALUES (?, ?, 'Bàn giờ', 'TIME', 'ACTIVE', ?, ?)`,
    )
      .bind(timeProdId, storeId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO product_variants (id, store_id, product_id, display_code, name, sale_price, cost_price, prompt_price, status, created_at, updated_at)
       VALUES (?, ?, ?, 'CF-01', 'Mặc định', 35000, 15000, 0, 'ACTIVE', ?, ?)`,
    )
      .bind(varId, storeId, prodId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO service_tables (id, store_id, area_id, time_product_id, name, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Bàn 1', 'AVAILABLE', 1, ?, ?)`,
    )
      .bind(tableId, storeId, areaId, timeProdId, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO customers (id, store_id, name, phone, normalized_phone, debt_balance_vnd, loyalty_points, created_by, created_at, updated_at)
       VALUES (?, ?, 'Nguyễn Văn A', '0901234567', '0901234567', 0, 100, ?, ?, ?)`,
    )
      .bind(customerId, storeId, ownerUser!.id, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO customer_groups (id, store_id, name, membership_type, created_by, created_at, updated_at)
       VALUES (?, ?, 'VIP', 'MANUAL', ?, ?, ?)`,
    )
      .bind(custGroupId, storeId, ownerUser!.id, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO customer_group_members (store_id, group_id, customer_id, added_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(storeId, custGroupId, customerId, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO promotions (id, store_id, name, promotion_type, scope, value, starts_at, status, created_by, created_at, updated_at)
       VALUES (?, ?, 'KM Giảm giá', 'PERCENT', 'INVOICE', 10, ?, 'ACTIVE', ?, ?, ?)`,
    )
      .bind(promoId, storeId, now, ownerUser!.id, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO promotion_targets (store_id, promotion_id, target_type, target_id)
       VALUES (?, ?, 'PRODUCT', ?)`,
    )
      .bind(storeId, promoId, prodId)
      .run();

    await env.DB.prepare(
      `INSERT INTO orders (id, store_id, table_id, status, version, opened_by, opened_at, created_at, updated_at)
       VALUES (?, ?, ?, 'PAID', 1, ?, ?, ?, ?)`,
    )
      .bind(orderId, storeId, tableId, ownerUser!.id, now, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO order_items (id, store_id, order_id, product_id, variant_id, product_type, product_name_snapshot, variant_name_snapshot, unit_price_snapshot, quantity_milli, gross_line_total, discount_amount, net_line_total, line_total, added_by, created_at, updated_at)
       VALUES ('oi-1', ?, ?, ?, ?, 'QUANTITY', 'Cà phê', 'Mặc định', 35000, 2000, 70000, 0, 70000, 70000, ?, ?, ?)`,
    )
      .bind(storeId, orderId, prodId, varId, ownerUser!.id, now, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO order_call_batches (id, store_id, order_id, order_type, sequence_no, actor_user_id, request_id, created_at)
       VALUES (?, ?, ?, 'DINE_IN', 1, ?, 'req-1', ?)`,
    )
      .bind(batchId, storeId, orderId, ownerUser!.id, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO order_call_batch_entries (id, store_id, batch_id, order_id, item_id, change_type, product_id, variant_id, product_type, product_name_snapshot, unit_price_snapshot, before_quantity_milli, delta_quantity_milli, after_quantity_milli, created_at)
       VALUES ('ocbe-1', ?, ?, ?, 'oi-1', 'ADD', ?, ?, 'QUANTITY', 'Cà phê', 35000, 0, 2000, 2000, ?)`,
    )
      .bind(storeId, batchId, orderId, prodId, varId, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO invoices (id, store_id, order_id, display_code, subtotal, discount_total, total, status, issued_at, issued_by, snapshot_json)
       VALUES (?, ?, ?, 'HD001', 70000, 0, 70000, 'COMPLETED', ?, ?, '{}')`,
    )
      .bind(invoiceId, storeId, orderId, now, ownerUser!.id)
      .run();

    await env.DB.prepare(
      `INSERT INTO invoice_lines (id, store_id, invoice_id, line_type, description, quantity_milli, unit_price, gross_line_total, discount_amount, line_total, snapshot_json)
       VALUES ('il-1', ?, ?, 'PRODUCT', 'Cà phê', 2000, 35000, 70000, 0, 70000, '{}')`,
    )
      .bind(storeId, invoiceId)
      .run();

    await env.DB.prepare(
      `INSERT INTO payments (id, store_id, order_id, method, status, amount, idempotency_key, created_by, created_at)
       VALUES (?, ?, ?, 'BANK_TRANSFER', 'SUCCEEDED', 70000, 'idemp-1', ?, ?)`,
    )
      .bind(paymentId, storeId, orderId, ownerUser!.id, now)
      .run();

    await env.DB.prepare(
      `INSERT INTO invoice_payment_allocations (id, store_id, invoice_id, method, amount_vnd, tendered_vnd, bank_account_id, created_at)
       VALUES ('ipa-1', ?, ?, 'BANK_TRANSFER', 70000, 70000, ?, ?)`,
    )
      .bind(storeId, invoiceId, bankAccId, now)
      .run();

    // Now call DELETE on the fully populated store
    const deleteResp = await SELF.fetch(`${ORIGIN}/api/v1/platform/stores/${storeId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'X-CSRF-Token': context.csrfToken!,
      },
    });
    expect(deleteResp.status).toBe(200);

    // Verify all rows in all tables for storeId are completely gone
    const storeRow = await env.DB.prepare('SELECT id FROM stores WHERE id = ?')
      .bind(storeId)
      .first();
    expect(storeRow).toBeNull();

    const orderRow = await env.DB.prepare('SELECT id FROM orders WHERE store_id = ?')
      .bind(storeId)
      .first();
    expect(orderRow).toBeNull();

    const invRow = await env.DB.prepare('SELECT id FROM invoices WHERE store_id = ?')
      .bind(storeId)
      .first();
    expect(invRow).toBeNull();

    const custRow = await env.DB.prepare('SELECT id FROM customers WHERE store_id = ?')
      .bind(storeId)
      .first();
    expect(custRow).toBeNull();

    const prodRow = await env.DB.prepare('SELECT id FROM products WHERE store_id = ?')
      .bind(storeId)
      .first();
    expect(prodRow).toBeNull();
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
    await env.DB
      .prepare('UPDATE store_settings SET employee_remember_session_hours = 48 WHERE store_id = ?')
      .bind(store!.id)
      .run();

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
    expect(login.headers.get('Set-Cookie')).toContain('Max-Age=172800');
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

  it('returns accessLogoutUrl on POST /api/v1/auth/logout for SUPER_ADMIN session in staging/production', async () => {
    const authorize = await completeAccess('PLATFORM_LOGIN', 'system.admin@example.com');
    if (authorize.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform login.');
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
        `/logout-callback?target=${encodeURIComponent(`${ORIGIN}/platform/login?loggedOut=1`)}`,
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

  it('rejects SUPER_ADMIN password login in staging/production with 403 PLATFORM_PASSWORD_LOGIN_DISABLED', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/v1/auth/platform/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'system.admin@example.com',
        password: 'AnyPassword123!',
      }),
    });
    expect(response.status).toBe(403);
    const json = (await response.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('PLATFORM_PASSWORD_LOGIN_DISABLED');
  });

  it('authenticates SUPER_ADMIN locally with valid password and rejects invalid password', async () => {
    const authService = new AuthService({
      ...env,
      ENVIRONMENT: 'local',
    });

    // Valid credentials
    const valid = await authService.platformLogin({
      username: 'system.admin@example.com',
      password: 'AdminPassword123!',
    });
    expect(valid.response.actor.kind).toBe('SUPER_ADMIN');
    expect(valid.rawToken).toBeDefined();

    // Invalid credentials
    await expect(
      authService.platformLogin({
        username: 'system.admin@example.com',
        password: 'WrongPassword!',
      }),
    ).rejects.toThrow('Tên đăng nhập hoặc mật khẩu không chính xác.');
  });

  it('allows SuperAdmin to update store member info and reset password', async () => {
    const platform = new PlatformService(env);
    if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
      await platform.bootstrap({
        bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
        email: 'system.admin@example.com',
        displayName: 'System Admin',
        password: 'AdminPassword123!',
      });
    }
    const store = await platform.createStore({
      name: 'Store for Member Edit',
      ownerDisplayName: 'Member Edit Owner',
      ownerEmail: 'member.edit.owner@example.com',
      ownerUsername: 'owner.edit.test',
      ownerPassword: 'OwnerPassword123!',
    });

    const details = await platform.getStoreDetails(store.storeId);
    const ownerMember = details.members.find((m) => m.roleCode === 'OWNER')!;
    expect(ownerMember).toBeDefined();

    // 1. Update owner info + new password
    const updateResult = await platform.updateStoreMember({
      storeId: store.storeId,
      userId: ownerMember.userId,
      displayName: 'Updated Owner Name',
      email: 'new.owner.email@example.com',
      phone: '0987654321',
      status: 'ACTIVE',
      newPassword: 'BrandNewPassword123!',
    });
    expect(updateResult.success).toBe(true);

    // 2. Check updated details
    const updatedDetails = await platform.getStoreDetails(store.storeId);
    const updatedOwner = updatedDetails.members.find((m) => m.userId === ownerMember.userId)!;
    expect(updatedOwner.displayName).toBe('Updated Owner Name');
    expect(updatedOwner.email).toBe('new.owner.email@example.com');
    expect(updatedOwner.phone).toBe('0987654321');

    // 3. Login with newly reset password
    const authService = new AuthService(env);
    const loginRes = await authService.ownerLogin({
      username: 'owner.edit.test',
      password: 'BrandNewPassword123!',
      rememberMe: true,
    });
    expect(loginRes.response.actor.displayName).toBe('Updated Owner Name');
    expect(loginRes.maxAgeSeconds).toBe(30 * 24 * 60 * 60);

    const loginShort = await authService.ownerLogin({
      username: 'owner.edit.test',
      password: 'BrandNewPassword123!',
      rememberMe: false,
    });
    expect(loginShort.maxAgeSeconds).toBe(24 * 60 * 60);
  });

  it('aggregates platform analytics and store performance data correctly', async () => {
    const platform = new PlatformService(env);
    const analytics = await platform.getPlatformAnalytics(14);

    expect(analytics.summary).toBeDefined();
    expect(analytics.summary.totalStores).toBeGreaterThanOrEqual(1);
    expect(analytics.revenueTrend).toHaveLength(14);
    expect(analytics.storePerformance.length).toBeGreaterThanOrEqual(1);
    expect(analytics.hourlyDistribution).toHaveLength(24);
    expect(Array.isArray(analytics.paymentMethods)).toBe(true);
    expect(Array.isArray(analytics.topProducts)).toBe(true);
  });
});
