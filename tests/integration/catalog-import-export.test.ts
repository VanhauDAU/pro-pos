import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CatalogImportRow } from '@contracts/catalog';
import { CatalogImportService } from '@server/services/catalog-import-service';
import { CatalogService } from '@server/services/catalog-service';
import { PlatformService } from '@server/services/platform-service';

function row(overrides: Partial<CatalogImportRow> = {}): CatalogImportRow {
  return {
    sourceRow: 5,
    productId: null,
    variantId: null,
    name: 'Nước cam',
    productType: 'Số lượng',
    categoryName: 'Đồ uống',
    unitName: 'Ly',
    variantName: 'Size M',
    salePrice: '30,000',
    costPrice: '15.000',
    promptPrice: 'Không',
    avatarColor: '#F97316',
    description: 'Nước cam tươi',
    timeBasePrice: null,
    timeBaseDurationMinutes: null,
    timeCalculationMode: null,
    timeRoundingUnit: null,
    timeFirstPeriodEnabled: null,
    timeFirstPeriodDurationMinutes: null,
    timeFirstPeriodPrice: null,
    ...overrides,
  };
}

describe('Catalog Excel import preview and commit', () => {
  let storeId: string;
  let ownerUserId: string;
  let importer: CatalogImportService;

  beforeAll(async () => {
    const store = await new PlatformService(env).createStore({
      name: 'Catalog Excel Import Store',
      ownerDisplayName: 'Catalog Import Owner',
      ownerEmail: 'catalog.import.owner@example.com',
    });
    storeId = store.storeId;
    ownerUserId = store.ownerUserId;
    importer = new CatalogImportService(env);
  });

  it('groups variants, creates named references once, and replays idempotent commits', async () => {
    const input = {
      rows: [row(), row({ sourceRow: 6, variantName: 'Size L', salePrice: '40 000' })],
      autoCreateCategories: true,
      autoCreateUnits: true,
    };
    const preview = await importer.preview(storeId, input);
    expect(preview.summary).toMatchObject({
      totalRows: 2,
      totalProducts: 1,
      createProducts: 1,
      newVariants: 2,
      categoriesToCreate: ['Đồ uống'],
      unitsToCreate: [],
    });
    expect(preview.summary.errorRows).toBe(0);

    const payload = {
      ...input,
      normalizedPayloadHash: preview.normalizedPayloadHash,
      skipInvalidGroups: false,
    };
    const auditContext = {
      actorUserId: ownerUserId,
      actorSessionId: null,
      deviceId: null,
      requestId: crypto.randomUUID(),
    };
    const committed = await importer.commit({
      storeId,
      payload,
      idempotencyKey: 'catalog-import-idempotent-001',
      auditContext,
    });
    expect(committed).toMatchObject({ createdProducts: 1, createdCategories: 1, createdUnits: 0 });
    const replay = await importer.commit({
      storeId,
      payload,
      idempotencyKey: 'catalog-import-idempotent-001',
      auditContext,
    });
    expect(replay.replayed).toBe(true);
    const products = await new CatalogService(env).listProducts(storeId);
    expect(products.results).toHaveLength(1);
    const detail = await new CatalogService(env).getProduct(
      storeId,
      String(products.results[0]!.id),
    );
    expect(detail.variants).toHaveLength(2);
  });

  it('skips new products whose normalized names already exist and never falls back from an unknown ID', async () => {
    const duplicate = await importer.preview(storeId, {
      rows: [row({ name: '  NƯỚC   CAM  ' })],
      autoCreateCategories: false,
      autoCreateUnits: false,
    });
    expect(duplicate.summary.skippedProducts).toBe(1);
    expect(duplicate.issues[0]).toMatchObject({ action: 'SKIP', message: 'Mặt hàng đã tồn tại.' });

    const unknown = await importer.preview(storeId, {
      rows: [row({ productId: '11111111-1111-4111-8111-111111111111' })],
      autoCreateCategories: false,
      autoCreateUnits: false,
    });
    expect(unknown.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ errorCode: 'PRODUCT_NOT_FOUND', action: 'ERROR' }),
      ]),
    );
  });

  it('validates TIME pricing and converts minutes to seconds', async () => {
    const preview = await importer.preview(storeId, {
      rows: [
        row({
          name: 'Giờ Pool',
          productType: 'Thời gian',
          variantName: null,
          salePrice: null,
          costPrice: null,
          promptPrice: 'Không',
          timeBasePrice: '60000',
          timeBaseDurationMinutes: '60',
          timeCalculationMode: 'Thời gian thực tế',
          timeRoundingUnit: '1000',
          timeFirstPeriodEnabled: 'Có',
          timeFirstPeriodDurationMinutes: '30',
          timeFirstPeriodPrice: '35000',
        }),
      ],
      autoCreateCategories: false,
      autoCreateUnits: false,
    });
    expect(preview.summary.errorRows).toBe(0);
    const payload = {
      rows: [
        row({
          name: 'Giờ Pool',
          productType: 'Thời gian',
          variantName: null,
          salePrice: null,
          costPrice: null,
          promptPrice: 'Không',
          timeBasePrice: '60000',
          timeBaseDurationMinutes: '60',
          timeCalculationMode: 'Thời gian thực tế',
          timeRoundingUnit: '1000',
          timeFirstPeriodEnabled: 'Có',
          timeFirstPeriodDurationMinutes: '30',
          timeFirstPeriodPrice: '35000',
        }),
      ],
      autoCreateCategories: false,
      autoCreateUnits: false,
      normalizedPayloadHash: preview.normalizedPayloadHash,
      skipInvalidGroups: false,
    };
    const commit = await importer.commit({
      storeId,
      payload,
      idempotencyKey: 'catalog-import-time-001',
      auditContext: {
        actorUserId: ownerUserId,
        actorSessionId: null,
        deviceId: null,
        requestId: crypto.randomUUID(),
      },
    });
    expect(commit.createdProducts).toBe(1);
    const products = await new CatalogService(env).listProducts(storeId);
    const time = products.results.find((product) => product.name === 'Giờ Pool')!;
    expect(
      (await new CatalogService(env).getProduct(storeId, String(time.id))).pricing,
    ).toMatchObject({
      baseDurationSeconds: 3600,
      firstPeriod: { durationSeconds: 1800 },
    });
  });

  it('exports canonical rows and updates one identified variant without duplicating or disabling siblings', async () => {
    const exported = await importer.exportRows(storeId);
    const orangeRows = exported.filter((item) => item.name === 'Nước cam');
    expect(orangeRows).toHaveLength(2);
    const changed = orangeRows.map((item, index) => ({ ...item, sourceRow: index + 9 }));
    const medium = changed.find((item) => item.variantName === 'Size M')!;
    medium.salePrice = '32.000';
    const preview = await importer.preview(storeId, {
      rows: changed,
      autoCreateCategories: false,
      autoCreateUnits: false,
    });
    expect(preview.summary).toMatchObject({
      updateProducts: 1,
      updateVariants: 2,
      errorRows: 0,
    });
    await importer.commit({
      storeId,
      payload: {
        rows: changed,
        autoCreateCategories: false,
        autoCreateUnits: false,
        normalizedPayloadHash: preview.normalizedPayloadHash,
        skipInvalidGroups: false,
      },
      idempotencyKey: 'catalog-import-roundtrip-001',
      auditContext: {
        actorUserId: ownerUserId,
        actorSessionId: null,
        deviceId: null,
        requestId: crypto.randomUUID(),
      },
    });
    const product = (await new CatalogService(env).listProducts(storeId)).results.find(
      (item) => item.name === 'Nước cam',
    )!;
    const detail = await new CatalogService(env).getProduct(storeId, String(product.id));
    expect(detail.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Size M', salePriceVnd: 32_000 }),
        expect.objectContaining({ name: 'Size L', salePriceVnd: 40_000 }),
      ]),
    );
    expect(detail.variants).toHaveLength(2);
  });
});
