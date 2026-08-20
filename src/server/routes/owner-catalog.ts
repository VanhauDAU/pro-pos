import { Hono } from 'hono';

import {
  createAreaLayoutSchema,
  createProductSchema,
  createServiceTableSchema,
  namedResourceSchema,
  pricingConfigSchema,
  reorderServiceTablesSchema,
  updateProductSchema,
  updateServiceTableSchema,
} from '@contracts/catalog';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { CatalogService } from '@server/services/catalog-service';
import type { AppEnv } from '@server/types';

const ownerCatalogRoutes = new Hono<AppEnv>();
ownerCatalogRoutes.use('*', requireActor('OWNER'));

function auditContext(c: Parameters<typeof success>[0]) {
  return {
    actorUserId: c.get('actor').id,
    actorSessionId: c.get('sessionId'),
    deviceId: c.get('device')?.id ?? null,
    requestId: c.get('requestId'),
  };
}

for (const table of ['areas', 'categories', 'units'] as const) {
  ownerCatalogRoutes.get(`/${table}`, requirePermission('catalog.manage'), async (c) => {
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

ownerCatalogRoutes.delete('/products/:productId', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    await new CatalogService(c.env).deleteProduct(
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
      timeProductId: body.timeProductId,
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
