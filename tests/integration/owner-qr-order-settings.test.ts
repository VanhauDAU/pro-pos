import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { OwnerQrOrderService } from '@server/services/owner-qr-order-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { QrOrderService } from '@server/services/qr-order-service';

describe('Owner QR Order settings', () => {
  let storeId: string;
  let ownerUserId: string;
  let openTableId: string;
  let availableTableId: string;
  let productId: string;
  let openTableToken: string;
  let availableTableToken: string;
  let rawGuest: string;

  const auditContext = (requestId: string) => ({
    actorUserId: ownerUserId,
    actorSessionId: null,
    deviceId: null,
    requestId,
  });

  beforeAll(async () => {
    const store = await new PlatformService(env).createStore({
      name: 'Owner QR Settings Store',
      ownerDisplayName: 'QR Owner',
      ownerEmail: 'owner-qr-settings@example.com',
    });
    storeId = store.storeId;
    ownerUserId = store.ownerUserId;

    const catalog = new CatalogService(env);
    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ phục vụ',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProduct.id,
      basePriceVnd: 60_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const product = await catalog.createProduct(storeId, {
      name: 'Nước suối QR',
      productType: 'QUANTITY',
      variants: [
        {
          name: 'Mặc định',
          salePriceVnd: 15_000,
          costPriceVnd: 5_000,
          promptPrice: false,
        },
        {
          name: 'Chai lớn',
          salePriceVnd: 25_000,
          costPriceVnd: 8_000,
          promptPrice: false,
        },
      ],
    });
    productId = product.id;
    await catalog.createAreaLayout(storeId, {
      name: 'Khu QR',
      tables: [{ name: 'Bàn đang phục vụ' }, { name: 'Bàn đang rảnh' }],
    });
    const [layout] = await catalog.listAreaLayouts(storeId);
    openTableId = layout!.tables[0]!.id;
    availableTableId = layout!.tables[1]!.id;
    await env.DB.prepare('UPDATE service_tables SET time_product_id = ? WHERE store_id = ?')
      .bind(timeProduct.id, storeId)
      .run();

    const qr = new QrOrderService(env);
    openTableToken = (await qr.getOrCreateQrCode(storeId, openTableId, ownerUserId)).path.replace(
      '/q/',
      '',
    );
    availableTableToken = (
      await qr.getOrCreateQrCode(storeId, availableTableId, ownerUserId)
    ).path.replace('/q/', '');

    await new PosService(env).openTable({
      storeId,
      tableId: openTableId,
      actorId: ownerUserId,
      expectedTableVersion: 1,
      requestId: 'open-owner-qr-table',
      idempotencyKey: 'open-owner-qr-table-command',
    });
    rawGuest = (
      await qr.resolveQr({
        rawQrToken: openTableToken,
        ip: '127.0.0.20',
        deviceNonce: 'owner-qr-settings-device',
      })
    ).rawGuest;
  });

  it('seeds quick reasons and exposes the same eligible QR menu', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    const [reasons, ownerMenu] = await Promise.all([
      ownerQr.listQuickReasons(storeId),
      ownerQr.listMenu(storeId),
    ]);
    expect(reasons.map((reason) => reason.label)).toEqual([
      'Thêm chén/đũa/muỗng',
      'Thêm nước/đá',
      'Dọn bàn',
      'Hỗ trợ món ăn',
    ]);
    expect(ownerMenu).toEqual(expect.arrayContaining([expect.objectContaining({ id: productId })]));
    const context = await new QrOrderService(env).getContext(rawGuest);
    expect(context.menu).toEqual(ownerMenu);
    expect(context.quickStaffReasons).toEqual(
      reasons.map((reason) => ({ id: reason.id, label: reason.label })),
    );
  });

  it('can hide one price variant from guest QR while retaining other variants', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    const product = (await ownerQr.listMenu(storeId)).find((item) => item.id === productId)!;
    const hiddenVariant = product.variants[0]!;
    const visibleVariant = product.variants[1]!;
    await ownerQr.setMenuVariantEnabled({
      storeId,
      variantId: hiddenVariant.id,
      enabled: false,
      auditContext: auditContext('hide-qr-menu-variant'),
    });
    expect(await ownerQr.listMenu(storeId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: productId,
          variants: expect.arrayContaining([
            expect.objectContaining({ id: hiddenVariant.id, qrOrderEnabled: false }),
            expect.objectContaining({ id: visibleVariant.id, qrOrderEnabled: true }),
          ]),
        }),
      ]),
    );
    const hiddenContext = await new QrOrderService(env).getContext(rawGuest);
    expect(hiddenContext.menu.find((item) => item.id === productId)?.variants).toEqual([
      expect.objectContaining({ id: visibleVariant.id }),
    ]);
    await expect(
      new QrOrderService(env).submitOrder(
        rawGuest,
        {
          clientRequestId: crypto.randomUUID(),
          items: [{ productId, variantId: hiddenVariant.id, quantity: 1 }],
        },
        '127.0.0.20',
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_AVAILABLE' });
    await ownerQr.setMenuVariantEnabled({
      storeId,
      variantId: hiddenVariant.id,
      enabled: true,
      auditContext: auditContext('show-qr-menu-variant'),
    });
  });

  it('uses configured service cooldowns and stores an immutable reason snapshot', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    const before = await ownerQr.getSettings(storeId);
    await ownerQr.updateSettings({
      storeId,
      values: {
        locationVerificationEnabled: false,
        latitude: null,
        longitude: null,
        allowedRadiusMeters: 300,
        maxAccuracyMeters: 100,
        locationMemoryMinutes: 60,
        orderCooldownSeconds: 3,
        callStaffCooldownSeconds: 120,
        checkoutCooldownSeconds: 90,
        salesScheduleEnabled: false,
        salesHours: [],
      },
      auditContext: auditContext('update-owner-qr-cooldowns'),
    });
    expect(before.callStaffCooldownSeconds).toBe(60);

    const reason = (await ownerQr.listQuickReasons(storeId))[0]!;
    const qr = new QrOrderService(env);
    const created = await qr.createServiceRequest(
      rawGuest,
      'CALL_STAFF',
      null,
      null,
      null,
      reason.id,
    );
    expect(created.reason).toBe(reason.label);
    expect(await qr.listServiceRequests(storeId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, reason: 'Thêm chén/đũa/muỗng' }),
      ]),
    );
    await expect(
      qr.createServiceRequest(rawGuest, 'CALL_STAFF', null, null, null, reason.id),
    ).rejects.toMatchObject({
      code: 'REQUEST_COOLDOWN',
      details: { retryAfterSeconds: expect.any(Number) },
    });
  });

  it('blocks opening tables and ordering while paused but keeps support and checkout available', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    await ownerQr.setSalesPaused({
      storeId,
      paused: true,
      auditContext: auditContext('pause-owner-qr-sales'),
    });
    const qr = new QrOrderService(env);
    await expect(qr.requestTableOpen(availableTableToken, '127.0.0.21')).rejects.toMatchObject({
      code: 'QR_ORDER_SALES_CLOSED',
    });
    await expect(
      qr.submitOrder(
        rawGuest,
        {
          clientRequestId: crypto.randomUUID(),
          items: [{ productId, quantity: 1 }],
        },
        '127.0.0.20',
      ),
    ).rejects.toMatchObject({ code: 'QR_ORDER_SALES_CLOSED' });

    await env.DB.prepare(
      `UPDATE service_requests SET status = 'COMPLETED', created_at = ?
       WHERE store_id = ? AND type = 'CALL_STAFF'`,
    )
      .bind(Date.now() - 121_000, storeId)
      .run();
    const support = await qr.createServiceRequest(
      rawGuest,
      'CALL_STAFF',
      null,
      null,
      null,
      null,
      'Cần hỗ trợ khi cửa hàng đang dừng gọi món',
    );
    expect(support.status).toBe('OPEN');
    const checkout = await qr.createServiceRequest(rawGuest, 'CHECKOUT_REQUEST');
    expect(checkout.status).toBe('OPEN');
    await ownerQr.setSalesPaused({
      storeId,
      paused: false,
      auditContext: auditContext('resume-owner-qr-sales'),
    });
    expect((await ownerQr.getSettings(storeId)).availability.acceptingOrders).toBe(true);
  });

  it('keeps existing verification when only memory changes and invalidates it on policy changes', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    const expiresAt = Date.now() + 60_000;
    await env.DB.prepare(
      `UPDATE guest_order_sessions SET location_verified_at = ?, location_expires_at = ?
       WHERE store_id = ? AND status = 'ACTIVE'`,
    )
      .bind(Date.now(), expiresAt, storeId)
      .run();
    const current = await ownerQr.getSettings(storeId);
    await ownerQr.updateSettings({
      storeId,
      values: {
        locationVerificationEnabled: false,
        latitude: null,
        longitude: null,
        allowedRadiusMeters: current.allowedRadiusMeters,
        maxAccuracyMeters: current.maxAccuracyMeters,
        locationMemoryMinutes: 30,
        orderCooldownSeconds: current.orderCooldownSeconds,
        callStaffCooldownSeconds: current.callStaffCooldownSeconds,
        checkoutCooldownSeconds: current.checkoutCooldownSeconds,
        salesScheduleEnabled: current.salesScheduleEnabled,
        salesHours: current.salesHours,
      },
      auditContext: auditContext('change-location-memory-only'),
    });
    const retained = await env.DB.prepare(
      `SELECT location_expires_at AS locationExpiresAt FROM guest_order_sessions
       WHERE store_id = ? AND status = 'ACTIVE' LIMIT 1`,
    )
      .bind(storeId)
      .first<{ locationExpiresAt: number | null }>();
    expect(retained?.locationExpiresAt).toBe(expiresAt);

    await ownerQr.updateSettings({
      storeId,
      values: {
        locationVerificationEnabled: true,
        latitude: 16.0544,
        longitude: 108.2022,
        allowedRadiusMeters: current.allowedRadiusMeters,
        maxAccuracyMeters: current.maxAccuracyMeters,
        locationMemoryMinutes: 30,
        orderCooldownSeconds: current.orderCooldownSeconds,
        callStaffCooldownSeconds: current.callStaffCooldownSeconds,
        checkoutCooldownSeconds: current.checkoutCooldownSeconds,
        salesScheduleEnabled: current.salesScheduleEnabled,
        salesHours: current.salesHours,
      },
      auditContext: auditContext('enable-location-verification'),
    });
    const invalidated = await env.DB.prepare(
      `SELECT location_verified_at AS locationVerifiedAt,
              location_expires_at AS locationExpiresAt
       FROM guest_order_sessions WHERE store_id = ? AND status = 'ACTIVE' LIMIT 1`,
    )
      .bind(storeId)
      .first<{ locationVerifiedAt: number | null; locationExpiresAt: number | null }>();
    expect(invalidated).toEqual({ locationVerifiedAt: null, locationExpiresAt: null });
  });

  it('archives deleted quick reasons while allowing the same label to be created again', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    const before = await ownerQr.listQuickReasons(storeId);
    const removed = before[0]!;
    await ownerQr.replaceQuickReasons({
      storeId,
      reasons: before.slice(1).map((reason) => ({
        id: reason.id,
        label: reason.label,
        enabled: reason.enabled,
      })),
      auditContext: auditContext('archive-quick-reason'),
    });
    expect((await ownerQr.listQuickReasons(storeId)).map((reason) => reason.id)).not.toContain(
      removed.id,
    );

    const remaining = await ownerQr.listQuickReasons(storeId);
    await ownerQr.replaceQuickReasons({
      storeId,
      reasons: [
        ...remaining.map((reason) => ({
          id: reason.id,
          label: reason.label,
          enabled: reason.enabled,
        })),
        { label: removed.label, enabled: true },
      ],
      auditContext: auditContext('recreate-quick-reason'),
    });
    const recreated = (await ownerQr.listQuickReasons(storeId)).find(
      (reason) => reason.label === removed.label,
    );
    expect(recreated?.id).toBeTruthy();
    expect(recreated?.id).not.toBe(removed.id);
  });
});
