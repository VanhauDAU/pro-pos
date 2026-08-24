import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { QrOrderService } from '@server/services/qr-order-service';
import { StoreService } from '@server/services/store-service';

describe('QR Order Customer Location Verification', () => {
  let storeId: string;
  let ownerUserId: string;
  let beverageProductId: string;
  let table1Id: string;
  let table2Id: string;
  let qrToken1: string;

  beforeAll(async () => {
    const store = await new PlatformService(env).createStore({
      name: 'Location Test Store',
      ownerDisplayName: 'Store Owner',
      ownerEmail: 'location.owner@example.com',
    });
    storeId = store.storeId;
    ownerUserId = store.ownerUserId;

    const catalog = new CatalogService(env);

    const timeProd = await catalog.createProduct(storeId, {
      name: 'Giờ chơi Bi-a',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProd.id,
      basePriceVnd: 60000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });

    const beverage = await catalog.createProduct(storeId, {
      name: 'Cà phê đá',
      productType: 'QUANTITY',
      variants: [
        {
          name: 'Mặc định',
          salePriceVnd: 25000,
          costPriceVnd: 10000,
          promptPrice: false,
        },
      ],
    });
    beverageProductId = beverage.id;

    await catalog.createAreaLayout(storeId, {
      name: 'Khu VIP',
      tables: [{ name: 'Bàn 01' }, { name: 'Bàn 02' }],
    });
    const layouts = await catalog.listAreaLayouts(storeId);
    table1Id = layouts[0]!.tables[0]!.id;
    table2Id = layouts[0]!.tables[1]!.id;

    await env.DB.prepare('UPDATE service_tables SET time_product_id = ? WHERE store_id = ?')
      .bind(timeProd.id, storeId)
      .run();

    const qr = new QrOrderService(env);
    const code1 = await qr.rotateQrCode(storeId, table1Id, ownerUserId);
    await qr.rotateQrCode(storeId, table2Id, ownerUserId);
    qrToken1 = code1.token;
  });

  it('allows guest to order freely when location verification is disabled', async () => {
    const pos = new PosService(env);
    const qr = new QrOrderService(env);

    // Open Table 1
    await pos.openTable({
      storeId,
      tableId: table1Id,
      actorId: ownerUserId,
      expectedTableVersion: 1,
      requestId: 'req-open-t1-free',
      idempotencyKey: 'cmd-open-t1-free',
    });

    const resolved = await qr.resolveQr({
      rawQrToken: qrToken1,
      ip: '127.0.0.1',
      deviceNonce: 'device-free',
    });

    expect(resolved.context.tableStatus).toBe('OPEN');
    expect(resolved.context.locationRequirement.required).toBe(false);
    expect(resolved.context.locationRequirement.isVerified).toBe(true);

    // Submit order without location verification
    const orderRes = await qr.submitOrder(
      resolved.rawGuest,
      {
        clientRequestId: crypto.randomUUID(),
        items: [{ productId: beverageProductId, quantity: 2 }],
      },
      '127.0.0.1',
    );
    expect(orderRes.replayed).toBe(false);

    // Call staff without location verification
    const reqRes = await qr.createServiceRequest(resolved.rawGuest, 'CALL_STAFF');
    expect(reqRes.status).toBe('OPEN');
  });

  it('rejects order if location verification enabled but coordinates are missing', async () => {
    const storeService = new StoreService(env);
    const qr = new QrOrderService(env);

    // Enable location verification but leave coordinates null
    await storeService.updateSettings({
      storeId,
      name: 'Location Test Store',
      phone: null,
      address: '123 Đường Bi-a',
      cutoff: 0,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: true,
      latitude: null,
      longitude: null,
    });

    const resolved = await qr.resolveQr({
      rawQrToken: qrToken1,
      ip: '127.0.0.1',
      deviceNonce: 'device-unconfigured',
    });

    expect(resolved.context.locationRequirement.required).toBe(true);
    expect(resolved.context.locationRequirement.configured).toBe(false);

    await expect(
      qr.submitOrder(
        resolved.rawGuest,
        {
          clientRequestId: crypto.randomUUID(),
          items: [{ productId: beverageProductId, quantity: 1 }],
        },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      code: 'STORE_LOCATION_NOT_CONFIGURED',
    });
  });

  it('strictly enforces accuracy, distance, and session verification when configured', async () => {
    const storeService = new StoreService(env);
    const qr = new QrOrderService(env);

    // Configure Store Location: Da Nang (16.0544, 108.2022), Radius 300m, Max Accuracy 100m
    await storeService.updateSettings({
      storeId,
      name: 'Location Test Store',
      phone: null,
      address: '123 Đường Bi-a, Đà Nẵng',
      cutoff: 0,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: true,
      latitude: 16.0544,
      longitude: 108.2022,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const resolved = await qr.resolveQr({
      rawQrToken: qrToken1,
      ip: '127.0.0.1',
      deviceNonce: 'device-loc-test',
    });

    expect(resolved.context.locationRequirement.required).toBe(true);
    expect(resolved.context.locationRequirement.configured).toBe(true);
    expect(resolved.context.locationRequirement.isVerified).toBe(false);

    // 1. Direct mutation without verification must be rejected
    await expect(
      qr.submitOrder(
        resolved.rawGuest,
        {
          clientRequestId: crypto.randomUUID(),
          items: [{ productId: beverageProductId, quantity: 1 }],
        },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      code: 'LOCATION_VERIFICATION_REQUIRED',
    });

    // 2. Reject inaccurate GPS (> 100m accuracy threshold)
    await expect(
      qr.verifyLocation(resolved.rawGuest, {
        latitude: 16.0544,
        longitude: 108.2022,
        accuracyMeters: 150, // > 100m max
      }),
    ).rejects.toMatchObject({
      code: 'LOCATION_TOO_INACCURATE',
    });

    // 3. Reject GPS outside allowed radius (> 300m, e.g. ~600m away)
    await expect(
      qr.verifyLocation(resolved.rawGuest, {
        latitude: 16.06,
        longitude: 108.2022,
        accuracyMeters: 15,
      }),
    ).rejects.toMatchObject({
      code: 'LOCATION_OUTSIDE_ALLOWED_RADIUS',
    });

    // 4. Accept valid GPS inside allowed radius (e.g. ~11m away)
    const verifyRes = await qr.verifyLocation(resolved.rawGuest, {
      latitude: 16.0545,
      longitude: 108.2022,
      accuracyMeters: 20,
    });

    expect(verifyRes.verified).toBe(true);
    expect(verifyRes.distanceMeters).toBeLessThan(50);
    expect(verifyRes.allowedRadiusMeters).toBe(300);
    expect(verifyRes.expiresAt).toBeGreaterThan(Date.now());

    // 5. Subsequent mutations must now SUCCEED
    const clientReqId = crypto.randomUUID();
    const orderRes = await qr.submitOrder(
      resolved.rawGuest,
      {
        clientRequestId: clientReqId,
        items: [{ productId: beverageProductId, quantity: 1 }],
      },
      '127.0.0.1',
    );
    expect(orderRes.replayed).toBe(false);

    // 6. Context should now report isVerified = true
    const updatedCtx = await qr.getContext(resolved.rawGuest);
    expect(updatedCtx.locationRequirement.isVerified).toBe(true);
    expect(updatedCtx.locationRequirement.verifiedExpiresAt).toBe(verifyRes.expiresAt);
  });

  it('rejects expired location sessions and requires re-verification', async () => {
    const qr = new QrOrderService(env);

    const resolved = await qr.resolveQr({
      rawQrToken: qrToken1,
      ip: '127.0.0.1',
      deviceNonce: 'device-expire-test',
    });

    // Verify location
    await qr.verifyLocation(resolved.rawGuest, {
      latitude: 16.0544,
      longitude: 108.2022,
      accuracyMeters: 10,
    });

    // Force expiration in DB (16 minutes ago)
    await env.DB.prepare('UPDATE guest_order_sessions SET location_expires_at = ?')
      .bind(Date.now() - 60_000)
      .run();

    // Context should report isVerified = false
    const context = await qr.getContext(resolved.rawGuest);
    expect(context.locationRequirement.isVerified).toBe(false);

    // Mutation should be rejected with LOCATION_VERIFICATION_REQUIRED
    await expect(
      qr.submitOrder(
        resolved.rawGuest,
        {
          clientRequestId: crypto.randomUUID(),
          items: [{ productId: beverageProductId, quantity: 1 }],
        },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      code: 'LOCATION_VERIFICATION_REQUIRED',
    });
  });
});
