import { Hono } from 'hono';

import {
  createAreaLayoutSchema,
  catalogImportCommitSchema,
  catalogExportSchema,
  catalogImportPreviewSchema,
  createProductSchema,
  createServiceTableSchema,
  createBatchServiceTablesSchema,
  namedResourceSchema,
  pricingConfigSchema,
  reorderServiceTablesSchema,
  updateProductSchema,
  updateServiceTableSchema,
  updateServiceTableStatusSchema,
  updateServiceTablePricingSchema,
} from '@contracts/catalog';
import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { CatalogService } from '@server/services/catalog-service';
import { CatalogImportService } from '@server/services/catalog-import-service';
import { RealtimeDispatcher } from '@server/realtime/realtime-dispatcher';
import type { AppEnv } from '@server/types';

const ownerCatalogRoutes = new Hono<AppEnv>();
ownerCatalogRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));

function auditContext(c: Parameters<typeof success>[0]) {
  return {
    actorUserId: c.get('actor').id,
    actorSessionId: c.get('sessionId'),
    deviceId: c.get('device')?.id ?? null,
    requestId: c.get('requestId'),
  };
}

function idempotencyKey(c: Parameters<typeof success>[0]) {
  const key = c.req.header('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 128) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Thiếu mã xác nhận hợp lệ.', 422);
  }
  return key;
}

ownerCatalogRoutes.post('/import/preview', requirePermission('catalog.manage'), async (c) => {
  const body = await parseJson(c.req.raw, catalogImportPreviewSchema);
  return success(c, await new CatalogImportService(c.env).preview(c.get('actor').storeId!, body));
});

ownerCatalogRoutes.post('/import/commit', requirePermission('catalog.manage'), async (c) => {
  const body = await parseJson(c.req.raw, catalogImportCommitSchema);
  const storeId = c.get('actor').storeId!;
  const result = await new CatalogImportService(c.env).commit({
    storeId,
    payload: body,
    idempotencyKey: idempotencyKey(c),
    auditContext: auditContext(c),
  });
  if (
    result.createdProducts ||
    result.updatedProducts ||
    result.createdCategories ||
    result.createdUnits
  ) {
    c.executionCtx.waitUntil(
      new RealtimeDispatcher(c.env).dispatchStore(storeId).catch(() => undefined),
    );
  }
  return success(c, result);
});

ownerCatalogRoutes.post('/export', requirePermission('catalog.manage'), async (c) => {
  const body = await parseJson(c.req.raw, catalogExportSchema);
  return success(
    c,
    await new CatalogImportService(c.env).exportRows(c.get('actor').storeId!, body.productIds),
  );
});

for (const table of ['areas', 'categories', 'units'] as const) {
  ownerCatalogRoutes.get(`/${table}`, requirePermission('catalog.manage'), async (c) => {
    if (table === 'units' && (c.req.query('page') || c.req.query('q'))) {
      return success(
        c,
        await new CatalogService(c.env).listUnits(c.get('actor').storeId!, {
          page: Number(c.req.query('page') ?? 1),
          pageSize: Number(c.req.query('pageSize') ?? 10),
          search: c.req.query('q') ?? '',
        }),
      );
    }
    const result = await new CatalogService(c.env).listNamed(c.get('actor').storeId!, table);
    return success(c, result.results);
  });
  ownerCatalogRoutes.post(`/${table}`, requirePermission('catalog.manage'), async (c) => {
    const body = await parseJson(c.req.raw, namedResourceSchema);
    return success(
      c,
      await new CatalogService(c.env).createNamed(c.get('actor').storeId!, table, body.name, {
        actorUserId: c.get('actor').id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      }),
      201,
    );
  });
}

ownerCatalogRoutes.post('/units/seed', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).seedDefaultUnits(c.get('actor').storeId!, auditContext(c)),
  ),
);

ownerCatalogRoutes.get('/units/:unitId/products', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    (
      await new CatalogService(c.env).getUnit(c.get('actor').storeId!, c.req.param('unitId'), {
        page: Number(c.req.query('page') ?? 1),
        pageSize: Number(c.req.query('pageSize') ?? 10),
        search: c.req.query('q') ?? '',
      })
    ).products,
  ),
);

ownerCatalogRoutes.get('/units/:unitId', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).getUnit(c.get('actor').storeId!, c.req.param('unitId')),
  ),
);

ownerCatalogRoutes.put('/units/:unitId', requirePermission('catalog.manage'), async (c) => {
  const body = await parseJson(c.req.raw, namedResourceSchema);
  return success(
    c,
    await new CatalogService(c.env).updateUnit(
      c.get('actor').storeId!,
      c.req.param('unitId'),
      body.name,
      auditContext(c),
    ),
  );
});

ownerCatalogRoutes.delete('/units/:unitId', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).deleteUnit(
      c.get('actor').storeId!,
      c.req.param('unitId'),
      auditContext(c),
    ),
  ),
);

ownerCatalogRoutes.put(
  '/categories/:categoryId',
  requirePermission('catalog.manage'),
  async (c) => {
    const body = await parseJson(c.req.raw, namedResourceSchema);
    return success(
      c,
      await new CatalogService(c.env).updateNamed(
        c.get('actor').storeId!,
        'categories',
        c.req.param('categoryId'),
        body.name,
        auditContext(c),
      ),
    );
  },
);

ownerCatalogRoutes.delete(
  '/categories/:categoryId',
  requirePermission('catalog.manage'),
  async (c) =>
    success(
      c,
      await new CatalogService(c.env).deleteCategory(
        c.get('actor').storeId!,
        c.req.param('categoryId'),
        auditContext(c),
      ),
    ),
);

ownerCatalogRoutes.get(
  '/categories/:categoryId/products',
  requirePermission('catalog.manage'),
  async (c) =>
    success(
      c,
      (
        await new CatalogService(c.env).listCategoryProducts(
          c.get('actor').storeId!,
          c.req.param('categoryId'),
          c.req.query('q'),
        )
      ).results,
    ),
);

ownerCatalogRoutes.put('/areas/:areaId', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, namedResourceSchema);
  return success(
    c,
    await new CatalogService(c.env).updateNamed(
      c.get('actor').storeId!,
      'areas',
      c.req.param('areaId'),
      body.name,
      auditContext(c),
    ),
  );
});

ownerCatalogRoutes.get('/area-layouts', requirePermission('table.manage'), async (c) =>
  success(c, await new CatalogService(c.env).listAreaLayouts(c.get('actor').storeId!)),
);

ownerCatalogRoutes.post('/area-layouts', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, createAreaLayoutSchema);
  return success(
    c,
    await new CatalogService(c.env).createAreaLayout(
      c.get('actor').storeId!,
      body,
      auditContext(c),
    ),
    201,
  );
});

ownerCatalogRoutes.put(
  '/area-layouts/:areaId/table-order',
  requirePermission('table.manage'),
  async (c) => {
    const body = await parseJson(c.req.raw, reorderServiceTablesSchema);
    return success(
      c,
      await new CatalogService(c.env).reorderTables(
        c.get('actor').storeId!,
        c.req.param('areaId'),
        body.tableIds,
        auditContext(c),
      ),
    );
  },
);

ownerCatalogRoutes.delete('/area-layouts/:areaId', requirePermission('table.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).deleteAreaLayout(
      c.get('actor').storeId!,
      c.req.param('areaId'),
      auditContext(c),
    ),
  ),
);

ownerCatalogRoutes.get('/products', requirePermission('catalog.manage'), async (c) => {
  const result = await new CatalogService(c.env).listProducts(c.get('actor').storeId!);
  return success(c, result.results);
});

ownerCatalogRoutes.post('/products', requirePermission('catalog.manage'), async (c) => {
  const body = await parseJson(c.req.raw, createProductSchema);
  return success(
    c,
    await new CatalogService(c.env).createProduct(c.get('actor').storeId!, body, {
      actorUserId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
    201,
  );
});

ownerCatalogRoutes.get('/products/:productId', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).getProduct(c.get('actor').storeId!, c.req.param('productId')),
  ),
);

ownerCatalogRoutes.put('/products/:productId', requirePermission('catalog.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateProductSchema);
  return success(
    c,
    await new CatalogService(c.env).updateProduct(
      c.get('actor').storeId!,
      c.req.param('productId'),
      body,
      auditContext(c),
    ),
  );
});

ownerCatalogRoutes.delete(
  '/products/:productId',
  requirePermission('catalog.products.delete', 'catalog.manage'),
  async (c) =>
    success(
      c,
      await new CatalogService(c.env).deleteProduct(
        c.get('actor').storeId!,
        c.req.param('productId'),
        auditContext(c),
      ),
    ),
);

ownerCatalogRoutes.post(
  '/products/:productId/restore',
  requirePermission('catalog.products.delete', 'catalog.products.edit', 'catalog.manage'),
  async (c) =>
    success(
      c,
      await new CatalogService(c.env).restoreProduct(
        c.get('actor').storeId!,
        c.req.param('productId'),
        auditContext(c),
      ),
    ),
);

ownerCatalogRoutes.put('/pricing', requirePermission('pricing.manage'), async (c) => {
  const body = await parseJson(c.req.raw, pricingConfigSchema);
  return success(
    c,
    await new CatalogService(c.env).upsertPricing(c.get('actor').storeId!, body, {
      actorUserId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  );
});

ownerCatalogRoutes.get('/tables', requirePermission('table.manage'), async (c) => {
  const result = await new CatalogService(c.env).listTables(c.get('actor').storeId!);
  return success(c, result.results);
});

ownerCatalogRoutes.post('/tables', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, createServiceTableSchema);
  return success(
    c,
    await new CatalogService(c.env).createTable({
      storeId: c.get('actor').storeId!,
      areaId: body.areaId,
      timeProductId: body.timeProductId ?? null,
      name: body.name,
      sortOrder: body.sortOrder,
      auditContext: {
        actorUserId: c.get('actor').id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    }),
    201,
  );
});

ownerCatalogRoutes.post('/tables/batch', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, createBatchServiceTablesSchema);
  return success(
    c,
    await new CatalogService(c.env).createTablesBatch({
      storeId: c.get('actor').storeId!,
      areaId: body.areaId,
      timeProductId: body.timeProductId ?? null,
      tables: body.tables,
      auditContext: {
        actorUserId: c.get('actor').id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    }),
    201,
  );
});

ownerCatalogRoutes.patch('/tables/:tableId', requirePermission('table.manage'), async (c) => {
  const body = await parseJson(c.req.raw, updateServiceTableSchema);
  return success(
    c,
    await new CatalogService(c.env).updateTable(
      c.get('actor').storeId!,
      c.req.param('tableId'),
      body.name,
      auditContext(c),
    ),
  );
});

ownerCatalogRoutes.patch(
  '/tables/:tableId/status',
  requirePermission('table.manage', 'catalog.manage'),
  async (c) => {
    const body = await parseJson(c.req.raw, updateServiceTableStatusSchema);
    return success(
      c,
      await new CatalogService(c.env).updateTableStatus(
        c.get('actor').storeId!,
        c.req.param('tableId'),
        body.status,
        auditContext(c),
      ),
    );
  },
);

ownerCatalogRoutes.patch(
  '/tables/:tableId/pricing',
  requirePermission('table.manage'),
  async (c) => {
    const body = await parseJson(c.req.raw, updateServiceTablePricingSchema);
    return success(
      c,
      await new CatalogService(c.env).updateTablePricing(
        c.get('actor').storeId!,
        c.req.param('tableId'),
        body.timeProductId,
        auditContext(c),
      ),
    );
  },
);

ownerCatalogRoutes.delete('/tables/:tableId', requirePermission('table.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).deleteTable(
      c.get('actor').storeId!,
      c.req.param('tableId'),
      auditContext(c),
    ),
  ),
);

export { ownerCatalogRoutes };
