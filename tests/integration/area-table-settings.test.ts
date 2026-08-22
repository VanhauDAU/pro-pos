import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAreaLayoutSchema } from '@contracts/catalog';
import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';

describe('Owner area and table settings', () => {
  let storeId: string;
  let catalog: CatalogService;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    const store = await platform.createStore({
      name: 'Area Layout Store',
      ownerDisplayName: 'Area Owner',
      ownerEmail: 'area.owner@example.com',
    });
    storeId = store.storeId;
    catalog = new CatalogService(env);
  });

  it('requires at least one table before an area can be created', () => {
    expect(createAreaLayoutSchema.safeParse({ name: 'Tầng 1', tables: [] }).success).toBe(false);
    expect(
      createAreaLayoutSchema.safeParse({ name: 'Tầng 1', tables: [{ name: 'Bàn 01' }] }).success,
    ).toBe(true);
  });

  it('creates one area with repeated table names in one atomic layout', async () => {
    const created = await catalog.createAreaLayout(storeId, {
      name: 'Khu vực sân vườn',
      tables: [{ name: 'Bàn 01' }, { name: 'Bàn 01' }],
    });

    const layouts = await catalog.listAreaLayouts(storeId);
    expect(layouts).toEqual([
      expect.objectContaining({
        id: created.id,
        name: 'Khu vực sân vườn',
        tables: [
          expect.objectContaining({ name: 'Bàn 01', status: 'AVAILABLE' }),
          expect.objectContaining({ name: 'Bàn 01', status: 'AVAILABLE' }),
        ],
      }),
    ]);

    const persisted = await env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM service_tables st
       JOIN products p ON p.id = st.time_product_id
       WHERE st.area_id = ? AND p.is_system = 1`,
    )
      .bind(created.id)
      .first<{ total: number }>();
    expect(persisted?.total).toBe(2);
  });

  it('persists the complete table display order and rejects incomplete lists', async () => {
    const [before] = await catalog.listAreaLayouts(storeId);
    const reversedIds = before!.tables.toReversed().map((table) => table.id);

    await catalog.reorderTables(storeId, before!.id, reversedIds);

    const [after] = await catalog.listAreaLayouts(storeId);
    expect(after!.tables.map((table) => table.id)).toEqual(reversedIds);
    expect(after!.tables.map((table) => table.sortOrder)).toEqual([0, 1]);
    await expect(
      catalog.reorderTables(storeId, before!.id, [reversedIds[0]!]),
    ).rejects.toMatchObject({ code: 'TABLE_ORDER_INVALID' });
  });

  it('assigns a priced time product to an available table and blocks occupied changes', async () => {
    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ VIP',
      productType: 'TIME',
      variants: [],
    });
    await catalog.upsertPricing(storeId, {
      productId: timeProduct.id,
      basePriceVnd: 90_000,
      baseDurationSeconds: 3600,
      calculationMode: 'ACTUAL_TIME',
      roundingUnitVnd: 1000,
      firstPeriod: { enabled: false },
      specialWindows: [],
    });
    const [layout] = await catalog.listAreaLayouts(storeId);
    const table = layout!.tables[0]!;
    await catalog.updateTablePricing(storeId, table.id, timeProduct.id);
    expect((await catalog.listAreaLayouts(storeId))[0]!.tables[0]).toMatchObject({
      id: table.id,
      timeProductId: timeProduct.id,
      timeProductName: 'Giờ VIP',
    });
    await env.DB.prepare("UPDATE service_tables SET status = 'OCCUPIED' WHERE id = ?")
      .bind(table.id)
      .run();
    await expect(
      catalog.updateTablePricing(storeId, table.id, timeProduct.id),
    ).rejects.toMatchObject({
      code: 'SERVICE_TABLE_OCCUPIED',
    });
    await env.DB.prepare("UPDATE service_tables SET status = 'AVAILABLE' WHERE id = ?")
      .bind(table.id)
      .run();
  });

  it('renames and deletes an available table', async () => {
    const [layout] = await catalog.listAreaLayouts(storeId);
    const table = layout!.tables[0]!;

    await catalog.updateTable(storeId, table.id, 'Phòng VIP');
    await catalog.deleteTable(storeId, table.id);

    const [updated] = await catalog.listAreaLayouts(storeId);
    expect(updated!.tables).toHaveLength(1);
    expect(updated!.tables[0]!.name).toBe('Bàn 01');
    const deleted = await env.DB.prepare(
      'SELECT display_name AS name, status FROM service_tables WHERE id = ?',
    )
      .bind(table.id)
      .first<{ name: string; status: string }>();
    expect(deleted).toBeNull();
  });

  it('pauses and resumes a table status and blocks pausing when occupied', async () => {
    const [layout] = await catalog.listAreaLayouts(storeId);
    const table = layout!.tables[0]!;

    // Pause table -> DISABLED
    await catalog.updateTableStatus(storeId, table.id, 'DISABLED');
    const [disabledLayout] = await catalog.listAreaLayouts(storeId);
    expect(disabledLayout!.tables[0]!.status).toBe('DISABLED');

    // Resume table -> AVAILABLE
    await catalog.updateTableStatus(storeId, table.id, 'AVAILABLE');
    const [resumedLayout] = await catalog.listAreaLayouts(storeId);
    expect(resumedLayout!.tables[0]!.status).toBe('AVAILABLE');

    // Block pausing occupied table
    await env.DB.prepare("UPDATE service_tables SET status = 'OCCUPIED' WHERE id = ?")
      .bind(table.id)
      .run();
    await expect(catalog.updateTableStatus(storeId, table.id, 'DISABLED')).rejects.toMatchObject({
      code: 'SERVICE_TABLE_OCCUPIED',
    });
    await env.DB.prepare("UPDATE service_tables SET status = 'AVAILABLE' WHERE id = ?")
      .bind(table.id)
      .run();
  });

  it('deletes an available area layout and blocks deletion while a table is occupied', async () => {
    const [availableArea] = await catalog.listAreaLayouts(storeId);
    await catalog.deleteAreaLayout(storeId, availableArea!.id);
    expect(await catalog.listAreaLayouts(storeId)).toEqual([]);

    const occupiedArea = await catalog.createAreaLayout(storeId, {
      name: 'Khu vực đang dùng',
      tables: [{ name: 'Bàn có khách' }],
    });
    const [layout] = await catalog.listAreaLayouts(storeId);
    await env.DB.prepare("UPDATE service_tables SET status = 'OCCUPIED' WHERE id = ?")
      .bind(layout!.tables[0]!.id)
      .run();

    await expect(catalog.deleteAreaLayout(storeId, occupiedArea.id)).rejects.toMatchObject({
      code: 'AREA_HAS_OCCUPIED_TABLES',
    });
    expect((await catalog.listAreaLayouts(storeId))[0]!.id).toBe(occupiedArea.id);
  });

  it('creates individual tables in an existing area and renames the area', async () => {
    const [layout] = await catalog.listAreaLayouts(storeId);
    await env.DB.prepare("UPDATE service_tables SET status = 'AVAILABLE' WHERE id = ?")
      .bind(layout!.tables[0]!.id)
      .run();

    const createdTable = await catalog.createTable({
      storeId,
      areaId: layout!.id,
      name: 'Bàn thêm mới',
    });
    expect(createdTable.name).toBe('Bàn thêm mới');

    await catalog.updateNamed(storeId, 'areas', layout!.id, 'Tầng 1 VIP');

    const [updated] = await catalog.listAreaLayouts(storeId);
    expect(updated!.name).toBe('Tầng 1 VIP');
    expect(updated!.tables).toHaveLength(2);
    expect(updated!.tables.some((t) => t.name === 'Bàn thêm mới')).toBe(true);
  });
});
