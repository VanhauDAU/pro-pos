import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';

describe('Owner catalog management', () => {
  let storeId: string;
  let catalog: CatalogService;
  let categoryId: string;
  let unitId: string;
  let productId: string;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    const store = await platform.createStore({
      name: 'Catalog Management Store',
      ownerDisplayName: 'Catalog Owner',
      ownerEmail: 'catalog.owner@example.com',
    });
    storeId = store.storeId;
    catalog = new CatalogService(env);
    ({ id: categoryId } = await catalog.createNamed(storeId, 'categories', 'Đồ uống'));
    const existingUnits = (await catalog.listNamed(storeId, 'units')).results;
    unitId = existingUnits.find((u) => u.name === 'Ly')!.id;
  });

  it('creates and reads a quantity product with variants and avatar metadata', async () => {
    ({ id: productId } = await catalog.createProduct(storeId, {
      name: 'Trà đào',
      description: 'Trà đào cam sả',
      productType: 'QUANTITY',
      categoryId,
      unitId,
      avatarType: 'COLOR',
      avatarColor: '#facc15',
      variants: [
        {
          name: 'Giá mặc định',
          salePriceVnd: 35_000,
          costPriceVnd: 12_000,
          promptPrice: false,
        },
      ],
    }));

    const product = await catalog.getProduct(storeId, productId);
    expect(product).toMatchObject({
      id: productId,
      name: 'Trà đào',
      productType: 'QUANTITY',
      categoryId,
      unitId,
      avatarColor: '#facc15',
    });
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({ name: 'Giá mặc định', salePriceVnd: 35_000 });
  });

  it('updates a product, lists it by category, and blocks deleting a used category', async () => {
    await catalog.updateProduct(storeId, productId, {
      name: 'Trà đào cam sả',
      description: null,
      productType: 'QUANTITY',
      categoryId,
      unitId,
      avatarType: 'COLOR',
      avatarColor: '#38bdf8',
      variants: [
        {
          name: 'Size M',
          salePriceVnd: 40_000,
          costPriceVnd: 15_000,
          promptPrice: false,
        },
      ],
    });

    const listed = await catalog.listCategoryProducts(storeId, categoryId, 'cam sả');
    expect(listed.results).toEqual([
      expect.objectContaining({ id: productId, name: 'Trà đào cam sả', variantCount: 1 }),
    ]);
    await expect(catalog.deleteCategory(storeId, categoryId)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_PRODUCTS',
    });
  });

  it('soft-deletes a product and allows deleting an empty category', async () => {
    await catalog.deleteProduct(storeId, productId);
    const product = await catalog.getProduct(storeId, productId);
    expect(product.status).toBe('DISABLED');
    await catalog.restoreProduct(storeId, productId);
    expect((await catalog.getProduct(storeId, productId)).status).toBe('ACTIVE');
    await catalog.deleteProduct(storeId, productId);
    await expect(catalog.deleteCategory(storeId, categoryId)).resolves.toMatchObject({
      deleted: true,
    });
  });

  it('persists special hours and rejects overlapping windows', async () => {
    const timeProduct = await catalog.createProduct(storeId, {
      name: 'Giờ Pool',
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
      specialWindows: [
        {
          name: 'Giờ tối',
          priceVnd: 70_000,
          startMinute: 21 * 60,
          endMinute: 23 * 60 + 45,
          weekdaysMask: 127,
        },
      ],
    });
    const detail = await catalog.getProduct(storeId, timeProduct.id);
    const pricing = detail.pricing as { specialWindows: Array<Record<string, unknown>> } | null;
    expect(pricing?.specialWindows).toEqual([
      expect.objectContaining({ name: 'Giờ tối', priceVnd: 70_000, weekdaysMask: 127 }),
    ]);
    await expect(
      catalog.upsertPricing(storeId, {
        productId: timeProduct.id,
        basePriceVnd: 60_000,
        baseDurationSeconds: 3600,
        calculationMode: 'ACTUAL_TIME',
        roundingUnitVnd: 1000,
        firstPeriod: { enabled: false },
        specialWindows: [
          {
            name: 'A',
            priceVnd: 70_000,
            startMinute: 21 * 60,
            endMinute: 23 * 60,
            weekdaysMask: 127,
          },
          {
            name: 'B',
            priceVnd: 80_000,
            startMinute: 22 * 60,
            endMinute: 23 * 60 + 30,
            weekdaysMask: 127,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PRICING_CONFIG_INVALID' });
  });
});
