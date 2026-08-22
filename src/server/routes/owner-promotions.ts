import { Hono } from 'hono';

import { promotionInputSchema, promotionStatusSchema } from '@contracts/promotion';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor } from '@server/middleware/authorization';
import { PromotionService } from '@server/services/promotion-service';
import type { AppEnv } from '@server/types';

const routes = new Hono<AppEnv>();
routes.use('*', requireActor('OWNER'));

routes.get('/', async (c) => {
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

routes.get('/product-options', async (c) =>
  success(c, await new PromotionService(c.env).listProductOptions(c.get('actor').storeId!)),
);

routes.post('/', async (c) => {
  const body = await parseJson(c.req.raw, promotionInputSchema);
  const actor = c.get('actor');
  return success(c, await new PromotionService(c.env).save(actor.storeId!, actor.id, body), 201);
});

routes.get('/:id', async (c) =>
  success(c, await new PromotionService(c.env).detail(c.get('actor').storeId!, c.req.param('id'))),
);

routes.put('/:id', async (c) => {
  const body = await parseJson(c.req.raw, promotionInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new PromotionService(c.env).save(actor.storeId!, actor.id, body, c.req.param('id')),
  );
});

routes.patch('/:id/status', async (c) => {
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

export { routes as ownerPromotionRoutes };
