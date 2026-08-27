import { Hono } from 'hono';

import { dashboardQuerySchema } from '@contracts/dashboard';
import { productReportQuerySchema } from '@contracts/reports';
import { success } from '@server/lib/response';
import { requireActor } from '@server/middleware/authorization';
import { OwnerDashboardService } from '@server/services/owner-dashboard-service';
import { OwnerProductReportService } from '@server/services/owner-product-report-service';
import type { AppEnv } from '@server/types';

const ownerAnalyticsRoutes = new Hono<AppEnv>();
ownerAnalyticsRoutes.use('*', requireActor('OWNER'));

function parseProductReportQuery(query: Record<string, string>) {
  return productReportQuerySchema.parse({
    reportType: query['reportType'] ?? 'CATEGORY',
    timeRange: query['timeRange'] ?? 'this_week',
    dateFrom: query['dateFrom'] ?? null,
    dateTo: query['dateTo'] ?? null,
    hourMode: query['hourMode'] ?? 'all',
    fromHour: query['fromHour'] ?? 0,
    fromMinute: query['fromMinute'] ?? 0,
    toHour: query['toHour'] ?? 0,
    toMinute: query['toMinute'] ?? 0,
    compareWith: query['compareWith'] ?? 'previous_period',
  });
}

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

ownerAnalyticsRoutes.get('/reports/products', async (c) => {
  const storeId = c.get('actor').storeId!;
  const parsed = parseProductReportQuery(c.req.query());
  const result = await new OwnerProductReportService(c.env).getProductReport(storeId, parsed);
  return success(c, result);
});

ownerAnalyticsRoutes.get('/reports/products/:productId/details', async (c) => {
  const storeId = c.get('actor').storeId!;
  const parsed = parseProductReportQuery(c.req.query());
  const result = await new OwnerProductReportService(c.env).getProductDetail(
    storeId,
    c.req.param('productId'),
    parsed,
  );
  return success(c, result);
});

export { ownerAnalyticsRoutes };
