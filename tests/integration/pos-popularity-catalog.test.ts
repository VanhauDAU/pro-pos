import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { PosRepository } from '@server/repositories/pos-repository';

describe('POS Catalog Popularity & 7-Day Hot Ranking', () => {
  let storeId: string;
  let ownerUserId: string;
  let catAId: string;
  let catBId: string;
  let posService: PosService;
  let catalogService: CatalogService;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.popularity@example.com',
      displayName: 'System Popularity',
    });
    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'POS Popularity Test Store',
      ownerDisplayName: 'Popularity Owner',
      ownerEmail: `popularity.test.${crypto.randomUUID()}@example.com`,
    }));

    catalogService = new CatalogService(env);
    posService = new PosService(env);

    // Create Category A (sort_order = 0) and Category B (sort_order = 1)
    const catA = await catalogService.createNamed(storeId, 'categories', 'Category A - Đồ Uống');
    catAId = catA.id;
    await env.DB.prepare('UPDATE categories SET sort_order = 0 WHERE id = ?').bind(catAId).run();

    const catB = await catalogService.createNamed(storeId, 'categories', 'Category B - Đồ Ăn');
    catBId = catB.id;
    await env.DB.prepare('UPDATE categories SET sort_order = 1 WHERE id = ?').bind(catBId).run();
  });

  async function createTestProduct(name: string, categoryId: string | null) {
    const created = await catalogService.createProduct(storeId, {
      name,
      categoryId,
      productType: 'QUANTITY',
      variants: [
        {
          name: 'Giá mặc định',
          salePriceVnd: 10_000,
          costPriceVnd: 0,
          promptPrice: false,
        },
      ],
    });
    const variants = await env.DB.prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND store_id = ?',
    )
      .bind(created.id, storeId)
      .all<{ id: string }>();
    return {
      id: created.id,
      variants: variants.results,
    };
  }

  async function simulateTakeawaySale(productId: string, variantId: string, timestamp: number) {
    const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const displayCode = `TK-${crypto.randomUUID().slice(0, 6)}`;

    await env.DB.prepare(
      `INSERT INTO takeaway_orders (
        id, store_id, display_code, status, version, opened_by, opened_at, closed_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'PAID', 1, ?, ?, ?, ?, ?)`,
    )
      .bind(orderId, storeId, displayCode, ownerUserId, timestamp, timestamp, timestamp, timestamp)
      .run();

    await env.DB.prepare(
      `INSERT INTO takeaway_order_items (
        id, store_id, order_id, product_id, variant_id, product_type, product_name_snapshot,
        unit_price_snapshot, quantity_milli, gross_line_total, net_line_total, added_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'QUANTITY', 'Product', 10000, 1000, 10000, 10000, ?, ?, ?)`,
    )
      .bind(itemId, storeId, orderId, productId, variantId, ownerUserId, timestamp, timestamp)
      .run();
  }

  async function simulateDineInSale(
    tableId: string,
    productId: string,
    variantId: string,
    timestamp: number,
    status: 'PAID' | 'OPEN' | 'CANCELLED' = 'PAID',
  ) {
    const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO orders (
        id, store_id, table_id, status, version, opened_by, opened_at, closed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
      .bind(
        orderId,
        storeId,
        tableId,
        status,
        ownerUserId,
        timestamp,
        status === 'PAID' ? timestamp : null,
        timestamp,
        timestamp,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO order_items (
        id, store_id, order_id, product_id, variant_id, product_type, product_name_snapshot,
        unit_price_snapshot, quantity_milli, line_total, added_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'QUANTITY', 'Product', 10000, 1000, 10000, ?, ?, ?)`,
    )
      .bind(itemId, storeId, orderId, productId, variantId, ownerUserId, timestamp, timestamp)
      .run();
  }

  it('1 & 3. Requires at least 3 sales in last 7 days for isPopular; 2 sales is NOT popular', async () => {
    const prod = await createTestProduct('Trà Sữa 3 Sales', catAId);
    const variantId = prod.variants[0]!.id;
    const now = Date.now();

    // 2 sales within 7 days
    await simulateTakeawaySale(prod.id, variantId, now - 1 * 24 * 3600 * 1000);
    await simulateTakeawaySale(prod.id, variantId, now - 2 * 24 * 3600 * 1000);

    let catalog = await posService.listCatalog(storeId);
    let item = catalog.find((p) => p.productId === prod.id)!;
    expect(item.isPopular).toBe(false);

    // 3rd sale within 7 days -> now eligible and popular
    await simulateTakeawaySale(prod.id, variantId, now - 3 * 24 * 3600 * 1000);

    catalog = await posService.listCatalog(storeId);
    item = catalog.find((p) => p.productId === prod.id)!;
    expect(item.isPopular).toBe(true);
  });

  it('2 & 7. Products sold 8-30 days ago have popularity weight but no isPopular; >30 days has no weight', async () => {
    const prod30d = await createTestProduct('Món Bán 15 Ngày Trước', catAId);
    const prodOld = await createTestProduct('Món Bán 35 Ngày Trước', catAId);
    const prodZero = await createTestProduct('Món Chưa Từng Bán', catAId);
    const now = Date.now();

    // prod30d sold 5 times 15 days ago
    for (let i = 0; i < 5; i++) {
      await simulateTakeawaySale(
        prod30d.id,
        prod30d.variants[0]!.id,
        now - 15 * 24 * 3600 * 1000 + i * 1000,
      );
    }

    // prodOld sold 10 times 35 days ago (> 30 days)
    for (let i = 0; i < 10; i++) {
      await simulateTakeawaySale(
        prodOld.id,
        prodOld.variants[0]!.id,
        now - 35 * 24 * 3600 * 1000 + i * 1000,
      );
    }

    const catalog = await posService.listCatalog(storeId);
    const item30d = catalog.find((p) => p.productId === prod30d.id)!;
    const itemOld = catalog.find((p) => p.productId === prodOld.id)!;
    const itemZero = catalog.find((p) => p.productId === prodZero.id)!;

    // None should be popular (0 sales in last 7 days)
    expect(item30d.isPopular).toBe(false);
    expect(itemOld.isPopular).toBe(false);
    expect(itemZero.isPopular).toBe(false);

    // item30d should rank ahead of itemZero and itemOld within Category A
    const catAProducts = catalog.filter((p) => p.categoryId === catAId);
    const idx30d = catAProducts.findIndex((p) => p.productId === prod30d.id);
    const idxZero = catAProducts.findIndex((p) => p.productId === prodZero.id);
    const idxOld = catAProducts.findIndex((p) => p.productId === prodOld.id);

    expect(idx30d).toBeLessThan(idxZero);
    expect(idx30d).toBeLessThan(idxOld);
  });

  it('4. Popular item limits scale dynamically by category size: 2 items -> max 1, 5 items -> max 2, 10+ items -> max 3', async () => {
    const now = Date.now();

    // 1. Category with 2 items (both have >= 3 sales) -> exactly 1 popular item
    const cat2 = await catalogService.createNamed(
      storeId,
      'categories',
      'Cat Dynamic Limit 2 Items',
    );
    const p2_1 = await createTestProduct('Cat2 - Rank 1 (5 sales)', cat2.id);
    const p2_2 = await createTestProduct('Cat2 - Rank 2 (4 sales)', cat2.id);
    for (let i = 0; i < 5; i++) {
      await simulateTakeawaySale(p2_1.id, p2_1.variants[0]!.id, now - 1000 * (i + 1));
    }
    for (let i = 0; i < 4; i++) {
      await simulateTakeawaySale(p2_2.id, p2_2.variants[0]!.id, now - 1000 * (i + 1));
    }

    // 2. Category with 5 items (all have >= 3 sales) -> exactly 2 popular items
    const cat5 = await catalogService.createNamed(
      storeId,
      'categories',
      'Cat Dynamic Limit 5 Items',
    );
    for (let i = 1; i <= 5; i++) {
      const p = await createTestProduct(`Cat5 - Rank ${i}`, cat5.id);
      for (let s = 0; s < 10 - i; s++) {
        await simulateTakeawaySale(p.id, p.variants[0]!.id, now - 1000 * (s + 1));
      }
    }

    // 3. Category with 10 items (all have >= 3 sales) -> exactly 3 popular items
    const cat10 = await catalogService.createNamed(
      storeId,
      'categories',
      'Cat Dynamic Limit 10 Items',
    );
    for (let i = 1; i <= 10; i++) {
      const p = await createTestProduct(`Cat10 - Rank ${i}`, cat10.id);
      for (let s = 0; s < 15 - i; s++) {
        await simulateTakeawaySale(p.id, p.variants[0]!.id, now - 1000 * (s + 1));
      }
    }

    const catalog = await posService.listCatalog(storeId);

    const prodsCat2 = catalog.filter((p) => p.categoryId === cat2.id);
    expect(prodsCat2.map((p) => p.isPopular)).toEqual([true, false]);

    const prodsCat5 = catalog.filter((p) => p.categoryId === cat5.id);
    expect(prodsCat5.map((p) => p.isPopular)).toEqual([true, true, false, false, false]);

    const prodsCat10 = catalog.filter((p) => p.categoryId === cat10.id);
    expect(prodsCat10.map((p) => p.isPopular)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('5. When soldLast7Days are equal, lastSoldAt DESC breaks ties for ranking', async () => {
    const catTie = await catalogService.createNamed(storeId, 'categories', 'Category Tie Test');
    await env.DB.prepare('UPDATE categories SET sort_order = 6 WHERE id = ?').bind(catTie.id).run();

    const pOlder = await createTestProduct('A - Older 4 Sales', catTie.id);
    const pNewer = await createTestProduct('Z - Newer 4 Sales', catTie.id);

    const now = Date.now();
    // Older sales: 3 days ago
    for (let i = 0; i < 4; i++) {
      await simulateTakeawaySale(
        pOlder.id,
        pOlder.variants[0]!.id,
        now - 3 * 24 * 3600 * 1000 + i * 1000,
      );
    }
    // Newer sales: 1 hour ago
    for (let i = 0; i < 4; i++) {
      await simulateTakeawaySale(pNewer.id, pNewer.variants[0]!.id, now - 3600 * 1000 + i * 1000);
    }

    const catalog = await posService.listCatalog(storeId);
    const catProducts = catalog.filter((p) => p.categoryId === catTie.id);

    // pNewer should rank ahead of pOlder even though alphabetically 'Z' comes after 'A'
    expect(catProducts[0]!.productId).toBe(pNewer.id);
    expect(catProducts[1]!.productId).toBe(pOlder.id);
  });

  it('6. Products in Category B never jump ahead of Category A due to high popularity', async () => {
    const prodB = await createTestProduct('Super Popular in Cat B', catBId);
    const now = Date.now();

    // 20 sales for prodB in Cat B
    for (let i = 0; i < 20; i++) {
      await simulateTakeawaySale(prodB.id, prodB.variants[0]!.id, now - 1000 * (i + 1));
    }

    const catalog = await posService.listCatalog(storeId);

    const firstCatBIndex = catalog.findIndex((p) => p.categoryId === catBId);
    const lastCatAIndex = catalog.findLastIndex((p) => p.categoryId === catAId);

    // All Category A products must precede all Category B products
    expect(lastCatAIndex).toBeLessThan(firstCatBIndex);
  });

  it('8 & 9. Both orders (table) and takeaway_orders count when PAID, but non-PAID orders are ignored', async () => {
    const area = await catalogService.createNamed(storeId, 'areas', 'Area Test');
    const timeProduct = await catalogService.createProduct(storeId, {
      name: 'Time',
      productType: 'TIME',
      variants: [{ name: 'Default', salePriceVnd: 50000, costPriceVnd: 0, promptPrice: false }],
    });
    const table = await catalogService.createTable({
      storeId,
      name: 'Table 1',
      areaId: area.id,
      timeProductId: timeProduct.id,
      sortOrder: 1,
    });

    const prodDual = await createTestProduct('Dual Order Source Product', catAId);
    const variantId = prodDual.variants[0]!.id;
    const now = Date.now();

    // 1 PAID takeaway sale
    await simulateTakeawaySale(prodDual.id, variantId, now - 1000);
    // 1 PAID dine-in table sale
    await simulateDineInSale(table.id, prodDual.id, variantId, now - 2000, 'PAID');
    // 1 OPEN dine-in table sale (should NOT count)
    await simulateDineInSale(table.id, prodDual.id, variantId, now - 3000, 'OPEN');
    // 1 CANCELLED dine-in table sale (should NOT count)
    await simulateDineInSale(table.id, prodDual.id, variantId, now - 4000, 'CANCELLED');

    // Total paid count is 2 -> not popular yet
    let catalog = await posService.listCatalog(storeId);
    let item = catalog.find((p) => p.productId === prodDual.id)!;
    expect(item.isPopular).toBe(false);

    // Add 1 more PAID dine-in table sale -> total 3 paid orders in 7 days -> isPopular = true
    await simulateDineInSale(table.id, prodDual.id, variantId, now - 5000, 'PAID');
    catalog = await posService.listCatalog(storeId);
    item = catalog.find((p) => p.productId === prodDual.id)!;
    expect(item.isPopular).toBe(true);
  });

  it('10. Does not introduce N+1 queries; uses single listSaleCatalog execution', async () => {
    const repo = new PosRepository(env.DB);
    const spy = vi.spyOn(repo, 'listSaleCatalog');
    const service = new PosService(env);
    // Inject repo spy
    (service as unknown as { repository: PosRepository }).repository = repo;

    const catalog = await service.listCatalog(storeId);
    expect(catalog.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('11. Category with 24 products appears before Category with 2 products regardless of sort_order', async () => {
    const platform = new PlatformService(env);
    const countTestStore = await platform.createStore({
      name: 'Category Count Test Store',
      ownerDisplayName: 'Count Owner',
      ownerEmail: `count.test.${crypto.randomUUID()}@example.com`,
    });
    const catalog = new CatalogService(env);
    const pos = new PosService(env);

    // Create Small Category with sort_order = 0 and 2 products
    const catSmall = await catalog.createNamed(countTestStore.storeId, 'categories', 'Cat 2 Mon');
    await env.DB.prepare('UPDATE categories SET sort_order = 0 WHERE id = ?')
      .bind(catSmall.id)
      .run();
    for (let i = 1; i <= 2; i++) {
      await catalog.createProduct(countTestStore.storeId, {
        name: `Mon Cat 2 - #${i}`,
        categoryId: catSmall.id,
        productType: 'QUANTITY',
        variants: [
          { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
        ],
      });
    }

    // Create Large Category with sort_order = 99 and 24 products
    const catLarge = await catalog.createNamed(countTestStore.storeId, 'categories', 'Cat 24 Mon');
    await env.DB.prepare('UPDATE categories SET sort_order = 99 WHERE id = ?')
      .bind(catLarge.id)
      .run();
    for (let i = 1; i <= 24; i++) {
      await catalog.createProduct(countTestStore.storeId, {
        name: `Mon Cat 24 - #${i.toString().padStart(2, '0')}`,
        categoryId: catLarge.id,
        productType: 'QUANTITY',
        variants: [
          { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
        ],
      });
    }

    const result = await pos.listCatalog(countTestStore.storeId);
    const firstLargeIndex = result.findIndex((p) => p.categoryId === catLarge.id);
    const lastLargeIndex = result.findLastIndex((p) => p.categoryId === catLarge.id);
    const firstSmallIndex = result.findIndex((p) => p.categoryId === catSmall.id);

    expect(firstLargeIndex).toBe(0);
    expect(lastLargeIndex).toBe(23);
    expect(firstSmallIndex).toBe(24);
  });

  it('12. When categoryProductCount is equal, categories are ordered by c.sort_order ASC', async () => {
    const platform = new PlatformService(env);
    const tieStore = await platform.createStore({
      name: 'Category Tie Store',
      ownerDisplayName: 'Tie Owner',
      ownerEmail: `tie.store.${crypto.randomUUID()}@example.com`,
    });
    const catalog = new CatalogService(env);
    const pos = new PosService(env);

    // Both categories have 3 products
    const catOrder2 = await catalog.createNamed(tieStore.storeId, 'categories', 'Cat Sort 2');
    await env.DB.prepare('UPDATE categories SET sort_order = 2 WHERE id = ?')
      .bind(catOrder2.id)
      .run();
    for (let i = 1; i <= 3; i++) {
      await catalog.createProduct(tieStore.storeId, {
        name: `Mon Sort 2 - #${i}`,
        categoryId: catOrder2.id,
        productType: 'QUANTITY',
        variants: [
          { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
        ],
      });
    }

    const catOrder1 = await catalog.createNamed(tieStore.storeId, 'categories', 'Cat Sort 1');
    await env.DB.prepare('UPDATE categories SET sort_order = 1 WHERE id = ?')
      .bind(catOrder1.id)
      .run();
    for (let i = 1; i <= 3; i++) {
      await catalog.createProduct(tieStore.storeId, {
        name: `Mon Sort 1 - #${i}`,
        categoryId: catOrder1.id,
        productType: 'QUANTITY',
        variants: [
          { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
        ],
      });
    }

    const result = await pos.listCatalog(tieStore.storeId);
    const firstCat1Index = result.findIndex((p) => p.categoryId === catOrder1.id);
    const lastCat1Index = result.findLastIndex((p) => p.categoryId === catOrder1.id);
    const firstCat2Index = result.findIndex((p) => p.categoryId === catOrder2.id);

    // Cat with sort_order = 1 comes before cat with sort_order = 2
    expect(firstCat1Index).toBe(0);
    expect(lastCat1Index).toBe(2);
    expect(firstCat2Index).toBe(3);
  });

  it('13. Multi-variant product counts as exactly 1 product, and inactive/system/TIME products do not count', async () => {
    const platform = new PlatformService(env);
    const filterStore = await platform.createStore({
      name: 'Filter Store',
      ownerDisplayName: 'Filter Owner',
      ownerEmail: `filter.store.${crypto.randomUUID()}@example.com`,
    });
    const catalog = new CatalogService(env);
    const pos = new PosService(env);

    // Cat A: 1 product with 5 variants (should count as 1 product)
    const catA = await catalog.createNamed(filterStore.storeId, 'categories', 'Cat Multi Variant');
    await env.DB.prepare('UPDATE categories SET sort_order = 0 WHERE id = ?').bind(catA.id).run();
    await catalog.createProduct(filterStore.storeId, {
      name: 'Product With 5 Variants',
      categoryId: catA.id,
      productType: 'QUANTITY',
      variants: [
        { name: 'V1', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
        { name: 'V2', salePriceVnd: 12000, costPriceVnd: 0, promptPrice: false },
        { name: 'V3', salePriceVnd: 14000, costPriceVnd: 0, promptPrice: false },
        { name: 'V4', salePriceVnd: 16000, costPriceVnd: 0, promptPrice: false },
        { name: 'V5', salePriceVnd: 18000, costPriceVnd: 0, promptPrice: false },
      ],
    });

    // Cat B: 2 distinct products with 1 variant each (should count as 2 products)
    // PLUS 1 disabled product, 1 system product, 1 TIME product (none of which should count)
    const catB = await catalog.createNamed(filterStore.storeId, 'categories', 'Cat Two Distinct');
    await env.DB.prepare('UPDATE categories SET sort_order = 99 WHERE id = ?').bind(catB.id).run();

    // 2 active saleable products
    for (let i = 1; i <= 2; i++) {
      await catalog.createProduct(filterStore.storeId, {
        name: `Mon Active #${i}`,
        categoryId: catB.id,
        productType: 'QUANTITY',
        variants: [
          { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
        ],
      });
    }

    // 1 DISABLED product
    const disabledProd = await catalog.createProduct(filterStore.storeId, {
      name: 'Disabled Product',
      categoryId: catB.id,
      productType: 'QUANTITY',
      variants: [
        { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
      ],
    });
    await env.DB.prepare("UPDATE products SET status = 'DISABLED' WHERE id = ?")
      .bind(disabledProd.id)
      .run();

    // 1 TIME product
    await catalog.createProduct(filterStore.storeId, {
      name: 'Time Product in Cat B',
      categoryId: catB.id,
      productType: 'TIME',
      variants: [],
    });

    // 1 is_system = 1 product
    const sysProd = await catalog.createProduct(filterStore.storeId, {
      name: 'System Product in Cat B',
      categoryId: catB.id,
      productType: 'QUANTITY',
      variants: [
        { name: 'Gia mac dinh', salePriceVnd: 10000, costPriceVnd: 0, promptPrice: false },
      ],
    });
    await env.DB.prepare('UPDATE products SET is_system = 1 WHERE id = ?').bind(sysProd.id).run();

    const result = await pos.listCatalog(filterStore.storeId);
    const firstCatBIndex = result.findIndex((p) => p.categoryId === catB.id);
    const lastCatBIndex = result.findLastIndex((p) => p.categoryId === catB.id);
    const firstCatAIndex = result.findIndex((p) => p.categoryId === catA.id);

    // Cat B has 2 active saleable products, Cat A has 1 active product (with 5 variants)
    // Therefore Cat B (count 2) must appear before Cat A (count 1) despite Cat A's sort_order = 0
    expect(firstCatBIndex).toBe(0);
    expect(lastCatBIndex).toBe(1);
    expect(firstCatAIndex).toBe(2);

    // Multi-variant product in Cat A has 5 variants
    const prodA = result.find((p) => p.categoryId === catA.id)!;
    expect(prodA.variants).toHaveLength(5);
  });
});
