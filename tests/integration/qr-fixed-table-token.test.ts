import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { QrOrderService } from '@server/services/qr-order-service';
import { OwnerQrOrderService } from '@server/services/owner-qr-order-service';

describe('QR Fixed Table Token', () => {
  let storeId: string;
  let ownerUserId: string;
  let table1Id: string;
  let table2Id: string;

  beforeAll(async () => {
    const store = await new PlatformService(env).createStore({
      name: 'QR Token Test Store',
      ownerDisplayName: 'Store Owner',
      ownerEmail: 'qr.token.owner@example.com',
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

    await catalog.createProduct(storeId, {
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
  });

  // CASE 1: Owner tạo QR A → GET QR = A → GET lần nữa = A
  it('CASE 1: getOrCreateQrCode returns same token on repeated calls', async () => {
    const qr = new QrOrderService(env);
    const first = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    expect(first.path).toMatch(/^\/q\//u);

    const second = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    expect(second.path).toBe(first.path);
    expect(second.version).toBe(first.version);

    const third = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    expect(third.path).toBe(first.path);
  });

  // CASE 2: Owner tạo QR A → POS mở modal QR → POS nhận A → QR A vẫn resolve được
  it('CASE 2: POS gets same QR as Owner and QR resolves', async () => {
    const qr = new QrOrderService(env);

    // Owner gets/creates QR
    const ownerQr = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);

    // POS gets QR (simulating getOrCreateQrCode from POS route)
    const posQr = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    expect(posQr.path).toBe(ownerQr.path);

    // Extract token and test resolve
    const token = ownerQr.path.replace('/q/', '');

    // Open the table so we can resolve fully
    const pos = new PosService(env);
    const tableVersion = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(table1Id)
      .first<{ version: number }>();

    await pos.openTable({
      storeId,
      tableId: table1Id,
      actorId: ownerUserId,
      expectedTableVersion: tableVersion!.version,
      requestId: 'req-case2-open',
      idempotencyKey: 'cmd-case2-open',
    });

    const resolved = await qr.resolveQr({
      rawQrToken: token,
      ip: '127.0.0.1',
      deviceNonce: 'device-case2',
    });
    expect(resolved.context.tableStatus).toBe('OPEN');
  });

  // CASE 3: POS mở QR nhiều lần → không tăng version → không thay token
  it('CASE 3: repeated POS getOrCreateQrCode does not increment version', async () => {
    const qr = new QrOrderService(env);
    const first = await qr.getOrCreateQrCode(storeId, table2Id, ownerUserId);

    for (let i = 0; i < 5; i++) {
      const result = await qr.getOrCreateQrCode(storeId, table2Id, ownerUserId);
      expect(result.path).toBe(first.path);
      expect(result.version).toBe(first.version);
    }
  });

  // CASE 4: Thanh toán order → guest session cũ revoked → QR A vẫn resolve được khi bàn AVAILABLE
  it('CASE 4: checkout revokes guest session but QR still resolves when AVAILABLE', async () => {
    const qr = new QrOrderService(env);
    const qrResult = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    const token = qrResult.path.replace('/q/', '');

    // Table should still be OCCUPIED from CASE 2
    const resolved = await qr.resolveQr({
      rawQrToken: token,
      ip: '127.0.0.1',
      deviceNonce: 'device-case4',
    });
    expect(resolved.context.tableStatus).toBe('OPEN');

    // Checkout the order
    const pos = new PosService(env);
    const openOrder = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE store_id = ? AND table_id = ? AND status = 'OPEN' LIMIT 1",
    )
      .bind(storeId, table1Id)
      .first<{ id: string; version: number }>();
    expect(openOrder).toBeTruthy();

    await pos.checkout({
      storeId,
      orderId: openOrder!.id,
      expectedOrderVersion: openOrder!.version,
      method: 'BANK_TRANSFER',
      cashReceivedVnd: null,
      actorId: ownerUserId,
      requestId: 'req-case4-checkout',
      idempotencyKey: 'cmd-case4-checkout',
    });

    // Now table should be AVAILABLE, QR should still resolve
    const resolvedAfter = await qr.resolveQr({
      rawQrToken: token,
      ip: '127.0.0.1',
      deviceNonce: 'device-case4b',
    });
    expect(resolvedAfter.context.tableStatus).toBe('AVAILABLE');

    // QR token should be the same
    const qrAfter = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    expect(qrAfter.path).toBe(qrResult.path);
  });

  // CASE 5: Mở order mới cùng bàn → QR A vẫn dùng được → guest session mới được tạo
  it('CASE 5: new order on same table reuses QR A', async () => {
    const qr = new QrOrderService(env);
    const qrResult = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    const token = qrResult.path.replace('/q/', '');

    // Open a new order
    const pos = new PosService(env);
    const tableVersion = await env.DB.prepare('SELECT version FROM service_tables WHERE id = ?')
      .bind(table1Id)
      .first<{ version: number }>();

    await pos.openTable({
      storeId,
      tableId: table1Id,
      actorId: ownerUserId,
      expectedTableVersion: tableVersion!.version,
      requestId: 'req-case5-open',
      idempotencyKey: 'cmd-case5-open',
    });

    // Resolve QR → should create new guest session
    const resolved = await qr.resolveQr({
      rawQrToken: token,
      ip: '127.0.0.1',
      deviceNonce: 'device-case5',
    });
    expect(resolved.context.tableStatus).toBe('OPEN');
    expect(resolved.rawGuest).toBeTruthy();

    // QR still same
    const qrAfter = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    expect(qrAfter.path).toBe(qrResult.path);
  });

  // CASE 6: Tắt rồi bật lại QR vẫn giữ nguyên mã cố định.
  it('CASE 6: disabling and re-enabling QR preserves the fixed token', async () => {
    const qr = new QrOrderService(env);
    const ownerQr = new OwnerQrOrderService(env);
    const before = await qr.getOrCreateQrCode(storeId, table2Id, ownerUserId);
    const tokenA = before.path.replace('/q/', '');
    await ownerQr.setTableEnabled({
      storeId,
      tableId: table2Id,
      enabled: false,
      auditContext: {
        actorUserId: ownerUserId,
        actorSessionId: null,
        deviceId: null,
        requestId: 'disable-fixed-qr',
      },
    });
    await expect(
      qr.resolveQr({ rawQrToken: tokenA, ip: '127.0.0.1', deviceNonce: 'device-case6' }),
    ).rejects.toMatchObject({ code: 'QR_ORDER_TABLE_DISABLED' });
    await ownerQr.setTableEnabled({
      storeId,
      tableId: table2Id,
      enabled: true,
      auditContext: {
        actorUserId: ownerUserId,
        actorSessionId: null,
        deviceId: null,
        requestId: 'enable-fixed-qr',
      },
    });
    const after = await qr.getOrCreateQrCode(storeId, table2Id, ownerUserId);
    expect(after.path).toBe(before.path);
    const resolved = await qr.resolveQr({
      rawQrToken: tokenA,
      ip: '127.0.0.1',
      deviceNonce: 'device-case6b',
    });
    expect(resolved.context.tableStatus).toBe('AVAILABLE');
  });

  // CASE 7: Không được tắt QR của bàn đang phục vụ.
  it('CASE 7: occupied tables cannot have QR Order disabled', async () => {
    const ownerQr = new OwnerQrOrderService(env);
    await expect(
      ownerQr.setTableEnabled({
        storeId,
        tableId: table1Id,
        enabled: false,
        auditContext: {
          actorUserId: ownerUserId,
          actorSessionId: null,
          deviceId: null,
          requestId: 'disable-occupied-qr',
        },
      }),
    ).rejects.toMatchObject({ code: 'QR_ORDER_TABLE_OCCUPIED' });
  });

  it('CASE 8: newly created tables have QR Order enabled by default', async () => {
    const tables = await new OwnerQrOrderService(env).listTables(storeId);
    expect(tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: table1Id, qrOrderEnabled: true }),
        expect.objectContaining({ id: table2Id, qrOrderEnabled: true }),
      ]),
    );
  });

  // CASE 9: QR của bàn A không thể resolve thành bàn B
  it('CASE 9: QR for table A cannot resolve to table B', async () => {
    const qr = new QrOrderService(env);

    const qrA = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    const qrB = await qr.getOrCreateQrCode(storeId, table2Id, ownerUserId);

    expect(qrA.path).not.toBe(qrB.path);

    // Resolve QR A — should resolve to table A context
    const tokenA = qrA.path.replace('/q/', '');
    const tokenB = qrB.path.replace('/q/', '');

    // Get the table names from resolving each
    const resolvedA = await qr.resolveQr({
      rawQrToken: tokenA,
      ip: '127.0.0.1',
      deviceNonce: 'device-case9a',
    });
    const resolvedB = await qr.resolveQr({
      rawQrToken: tokenB,
      ip: '127.0.0.1',
      deviceNonce: 'device-case9b',
    });

    expect(resolvedA.context.table?.id ?? resolvedA.context.table?.name).not.toBe(
      resolvedB.context.table?.id ?? resolvedB.context.table?.name,
    );
  });

  // CASE 10: Bàn DISABLED → QR không cho thực hiện gọi món/mở bàn
  it('CASE 10: disabled table QR does not allow ordering', async () => {
    const qr = new QrOrderService(env);
    const catalog = new CatalogService(env);

    // First checkout any existing order on table1
    const openOrder = await env.DB.prepare(
      "SELECT id, version FROM orders WHERE store_id = ? AND table_id = ? AND status = 'OPEN' LIMIT 1",
    )
      .bind(storeId, table1Id)
      .first<{ id: string; version: number }>();
    if (openOrder) {
      await new PosService(env).checkout({
        storeId,
        orderId: openOrder.id,
        expectedOrderVersion: openOrder.version,
        method: 'BANK_TRANSFER',
        cashReceivedVnd: null,
        actorId: ownerUserId,
        requestId: 'req-case10-checkout',
        idempotencyKey: 'cmd-case10-checkout',
      });
    }

    // Get QR token before disabling
    const qrResult = await qr.getOrCreateQrCode(storeId, table1Id, ownerUserId);
    const token = qrResult.path.replace('/q/', '');

    // Disable the table
    await catalog.updateTableStatus(storeId, table1Id, 'DISABLED');

    // QR should not resolve
    await expect(
      qr.resolveQr({ rawQrToken: token, ip: '127.0.0.1', deviceNonce: 'device-case10' }),
    ).rejects.toThrow(/bàn hiện không nhận gọi món/u);

    // Re-enable the table for cleanup
    await catalog.updateTableStatus(storeId, table1Id, 'AVAILABLE');
  });
});
