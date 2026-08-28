import { Hono } from 'hono';

import { promotionInputSchema, promotionStatusSchema } from '@contracts/promotion';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { PromotionService } from '@server/services/promotion-service';
import { CatalogService } from '@server/services/catalog-service';
import { CustomerService } from '@server/services/customer-service';
import { promotionManagementPermissionKeys } from '@contracts/staff';
import type { AppEnv } from '@server/types';

const routes = new Hono<AppEnv>();
routes.use('*', requireActor('OWNER', 'EMPLOYEE'));

routes.get('/', requirePermission(...promotionManagementPermissionKeys), async (c) => {
  const search = c.req.query('search')?.trim();
  const status = c.req.query('status');
  const type = c.req.query('type');
  return success(
    c,
    await new PromotionService(c.env).list(c.get('actor').storeId!, {
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    }),
  );
});

routes.get('/product-options', requirePermission(...promotionManagementPermissionKeys), async (c) =>
  success(c, await new PromotionService(c.env).listProductOptions(c.get('actor').storeId!)),
);

routes.get(
  '/category-options',
  requirePermission(...promotionManagementPermissionKeys),
  async (c) => {
    const result = await new CatalogService(c.env).listNamed(c.get('actor').storeId!, 'categories');
    return success(c, result.results);
  },
);

routes.get(
  '/customer-group-options',
  requirePermission(...promotionManagementPermissionKeys),
  async (c) => success(c, await new CustomerService(c.env).listGroups(c.get('actor').storeId!)),
);

routes.post('/', requirePermission('promotion.create'), async (c) => {
  const body = await parseJson(c.req.raw, promotionInputSchema);
  const actor = c.get('actor');
  return success(c, await new PromotionService(c.env).save(actor.storeId!, actor.id, body), 201);
});

routes.get('/:id', requirePermission('promotion.edit', 'promotion.delete'), async (c) =>
  success(c, await new PromotionService(c.env).detail(c.get('actor').storeId!, c.req.param('id'))),
);

routes.put('/:id', requirePermission('promotion.edit'), async (c) => {
  const body = await parseJson(c.req.raw, promotionInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PromotionService(c.env).save(actor.storeId!, actor.id, body, c.req.param('id')),
  );
});

routes.patch('/:id/status', requirePermission('promotion.edit'), async (c) => {
  const body = await parseJson(c.req.raw, promotionStatusSchema);
  return success(
    c,
    await new PromotionService(c.env).setActive(
      c.get('actor').storeId!,
      c.req.param('id'),
      body.active,
    ),
  );
});

routes.delete('/:id', requirePermission('promotion.delete'), async (c) =>
  success(c, await new PromotionService(c.env).delete(c.get('actor').storeId!, c.req.param('id'))),
);

export { routes as ownerPromotionRoutes };
