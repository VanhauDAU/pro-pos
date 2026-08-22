import { Hono } from 'hono';

import {
  customerGroupInputSchema,
  customerImportSchema,
  customerInputSchema,
  debtAdjustmentSchema,
  debtPaymentSchema,
  loyaltySettingsSchema,
} from '@contracts/customer';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor } from '@server/middleware/authorization';
import { CustomerService } from '@server/services/customer-service';
import type { AppEnv } from '@server/types';

const routes = new Hono<AppEnv>();
routes.use('*', requireActor('OWNER'));

routes.get('/', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)));
  const search = c.req.query('search')?.trim();
  const status = c.req.query('status');
  return success(
    c,
    await new CustomerService(c.env).list(c.get('actor').storeId!, {
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      page,
      limit,
    }),
  );
});

routes.get('/loyalty-settings', async (c) =>
  success(c, await new CustomerService(c.env).loyaltySettings(c.get('actor').storeId!)),
);
routes.put('/loyalty-settings', async (c) => {
  const body = await parseJson(c.req.raw, loyaltySettingsSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).saveLoyaltySettings(
      actor.storeId!,
      actor.id,
      body.enabled,
      body.vndPerPoint,
    ),
  );
});

routes.get('/groups', async (c) =>
  success(c, await new CustomerService(c.env).listGroups(c.get('actor').storeId!)),
);
routes.post('/import/validate', async (c) => {
  const body = await parseJson(c.req.raw, customerImportSchema);
  return success(
    c,
    await new CustomerService(c.env).validateImport(c.get('actor').storeId!, body.rows),
  );
});
routes.post('/import', async (c) => {
  const body = await parseJson(c.req.raw, customerImportSchema);
  const actor = c.get('actor');
  return success(c, await new CustomerService(c.env).import(actor.storeId!, actor.id, body.rows));
});
routes.post('/groups', async (c) => {
  const body = await parseJson(c.req.raw, customerGroupInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).saveGroup(actor.storeId!, actor.id, body),
    201,
  );
});
routes.get('/groups/:id', async (c) =>
  success(
    c,
    await new CustomerService(c.env).groupDetail(c.get('actor').storeId!, c.req.param('id')),
  ),
);
routes.put('/groups/:id', async (c) => {
  const body = await parseJson(c.req.raw, customerGroupInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).saveGroup(actor.storeId!, actor.id, body, c.req.param('id')),
  );
});
routes.delete('/groups/:id', async (c) =>
  success(
    c,
    await new CustomerService(c.env).deleteGroup(c.get('actor').storeId!, c.req.param('id')),
  ),
);

routes.post('/', async (c) => {
  const body = await parseJson(c.req.raw, customerInputSchema);
  const actor = c.get('actor');
  return success(c, await new CustomerService(c.env).create(actor.storeId!, actor.id, body), 201);
});
routes.get('/:id', async (c) =>
  success(c, await new CustomerService(c.env).detail(c.get('actor').storeId!, c.req.param('id'))),
);
routes.put('/:id', async (c) => {
  const body = await parseJson(c.req.raw, customerInputSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).update(actor.storeId!, c.req.param('id'), body),
  );
});
routes.delete('/:id', async (c) =>
  success(c, await new CustomerService(c.env).archive(c.get('actor').storeId!, c.req.param('id'))),
);
routes.post('/:id/debt-payments', async (c) => {
  const body = await parseJson(c.req.raw, debtPaymentSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).payDebt(actor.storeId!, c.req.param('id'), actor.id, body),
  );
});
routes.post('/:id/debt-adjustments', async (c) => {
  const body = await parseJson(c.req.raw, debtAdjustmentSchema);
  const actor = c.get('actor');
  return success(
    c,
    await new CustomerService(c.env).adjustDebt(actor.storeId!, c.req.param('id'), actor.id, body),
  );
});

export { routes as ownerCustomerRoutes };
