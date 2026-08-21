import { Hono } from 'hono';

import { dashboardQuerySchema } from '@contracts/dashboard';
import { success } from '@server/lib/response';
import { requireActor } from '@server/middleware/authorization';
import { OwnerDashboardService } from '@server/services/owner-dashboard-service';
import type { AppEnv } from '@server/types';

const ownerAnalyticsRoutes = new Hono<AppEnv>();
ownerAnalyticsRoutes.use('*', requireActor('OWNER'));

ownerAnalyticsRoutes.get('/dashboard', async (c) => {
  const storeId = c.get('actor').storeId!;
  const qs = c.req.query();

  const parsed = dashboardQuerySchema.parse({
    range: qs['range'] ?? 'today',
    dateFrom: qs['dateFrom'] ?? null,
    dateTo: qs['dateTo'] ?? null,
  });

  const result = await new OwnerDashboardService(c.env).getDashboardData(storeId, parsed);
  return success(c, result);
});

export { ownerAnalyticsRoutes };
