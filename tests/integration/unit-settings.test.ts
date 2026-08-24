import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';

describe('Owner unit settings', () => {
  let storeId: string;
  let catalog: CatalogService;
  let unitId: string;
  let unusedUnitId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    const store = await platform.createStore({
      name: 'Unit Settings Store',
      ownerDisplayName: 'Unit Owner',
      ownerEmail: 'unit.owner@example.com',
    });
    storeId = store.storeId;
    catalog = new CatalogService(env);
    const existingUnits = (await catalog.listNamed(storeId, 'units')).results;
    unitId = existingUnits.find((u) => u.name === 'Chai')!.id;
    unusedUnitId = existingUnits.find((u) => u.name === 'Cái')!.id;
  });

  it('seeds default units idempotently', async () => {
    // Since store already has all default units, seed should insert 0
    const res = await catalog.seedDefaultUnits(storeId);
    expect(res.insertedCount).toBe(0);
  });


  it('paginates units and returns active product usage counts', async () => {
    const category = await catalog.createNamed(storeId, 'categories', 'Đồ uống');
    await catalog.createProduct(storeId, {
      name: 'Nước suối',
      productType: 'QUANTITY',
      categoryId: category.id,
      unitId,
      variants: [
        { name: 'Giá mặc định', salePriceVnd: 10_000, costPriceVnd: 0, promptPrice: false },
      ],
    });

    const page = await catalog.listUnits(storeId, { page: 1, pageSize: 1, search: 'chai' });
    expect(page).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(page.items).toEqual([
      expect.objectContaining({ id: unitId, name: 'Chai', productCount: 1 }),
    ]);
  });

  it('updates a unit and lists products using it with pagination', async () => {
    await catalog.updateUnit(storeId, unitId, 'Chai / lon');
    const detail = await catalog.getUnit(storeId, unitId, { page: 1, pageSize: 10 });
    expect(detail).toMatchObject({ id: unitId, name: 'Chai / lon' });
    expect(detail.products).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(detail.products.items[0]).toMatchObject({ name: 'Nước suối', productType: 'QUANTITY' });
  });

  it('blocks deleting a used unit and deletes an unused unit', async () => {
    await expect(catalog.deleteUnit(storeId, unitId)).rejects.toMatchObject({
      code: 'UNIT_IN_USE',
    });
    await expect(catalog.deleteUnit(storeId, unusedUnitId)).resolves.toMatchObject({
      deleted: true,
    });
  });
});
