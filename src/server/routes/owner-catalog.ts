import { Hono } from 'hono';

import {
  createProductSchema,
  createServiceTableSchema,
  namedResourceSchema,
  pricingConfigSchema,
} from '@contracts/catalog';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { CatalogService } from '@server/services/catalog-service';
import type { AppEnv } from '@server/types';

const ownerCatalogRoutes = new Hono<AppEnv>();
ownerCatalogRoutes.use('*', requireActor('OWNER'));

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

export { ownerCatalogRoutes };
