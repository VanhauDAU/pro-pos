import { Hono } from 'hono';

import { dashboardQuerySchema } from '@contracts/dashboard';
import { printProductReportSchema, productReportQuerySchema } from '@contracts/reports';
import {
  printRevenueReportSchema,
  revenueReportQuerySchema,
  revenueReportTypePermissions,
} from '@contracts/revenue-report';
import { success } from '@server/lib/response';
import { AppError } from '@server/lib/app-error';
import { parseJson } from '@server/lib/validation';
import {
  requireActor,
  requireActorOrPrintAgent,
  assertPermission,
  requirePermission,
} from '@server/middleware/authorization';
import { OwnerDashboardService } from '@server/services/owner-dashboard-service';
import { OwnerProductReportService } from '@server/services/owner-product-report-service';
import { OwnerRevenueReportService } from '@server/services/owner-revenue-report-service';
import { ProductReportPrintService } from '@server/services/product-report-print-service';
import { RevenueReportPrintService } from '@server/services/revenue-report-print-service';
import type { AppEnv } from '@server/types';

const ownerAnalyticsRoutes = new Hono<AppEnv>();

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

function parseRevenueReportQuery(query: Record<string, string>) {
  return revenueReportQuerySchema.parse({
    reportType: query['reportType'] ?? 'OVERVIEW',
    employeeId: query['employeeId'] ?? null,
    timeRange: query['timeRange'] ?? 'today',
    dateFrom: query['dateFrom'] ?? null,
    dateTo: query['dateTo'] ?? null,
    hourMode: query['hourMode'] ?? 'all',
    fromHour: query['fromHour'] ?? 0,
    fromMinute: query['fromMinute'] ?? 0,
    toHour: query['toHour'] ?? 0,
    toMinute: query['toMinute'] ?? 0,
  });
}

ownerAnalyticsRoutes.get('/dashboard', requireActor('OWNER'), async (c) => {
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

ownerAnalyticsRoutes.get('/reports/revenue', requireActor('OWNER', 'EMPLOYEE'), async (c) => {
  const storeId = c.get('actor').storeId!;
  const parsed = parseRevenueReportQuery(c.req.query());
  await assertPermission(c, revenueReportTypePermissions[parsed.reportType]);
  return success(c, await new OwnerRevenueReportService(c.env).getRevenueReport(storeId, parsed));
});

ownerAnalyticsRoutes.post(
  '/reports/revenue/print',
  requireActor('OWNER', 'EMPLOYEE'),
  async (c) => {
    const body = await parseJson(c.req.raw, printRevenueReportSchema);
    const actor = c.get('actor');
    const {
      targetDeviceId,
      idempotencyKey,
      timeRange,
      dateFrom,
      dateTo,
      hourMode,
      fromHour,
      fromMinute,
      toHour,
      toMinute,
    } = body;
    await assertPermission(c, revenueReportTypePermissions[body.reportType]);
    await assertPermission(c, 'report.revenue.print');
    if (actor.kind !== 'OWNER' && actor.kind !== 'EMPLOYEE') {
      throw new AppError(
        'ACTOR_KIND_UNSUPPORTED',
        'Loại tài khoản không hỗ trợ in báo cáo doanh thu.',
        403,
      );
    }
    const service = new RevenueReportPrintService(c.env, (promise) =>
      c.executionCtx.waitUntil(promise),
    );
    return success(
      c,
      await service.queue({
        storeId: actor.storeId!,
        actorUserId: actor.id,
        actorName: actor.displayName,
        actorKind: actor.kind,
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
        query: {
          reportType: body.reportType,
          employeeId: body.employeeId,
          timeRange,
          dateFrom,
          dateTo,
          hourMode,
          fromHour,
          fromMinute,
          toHour,
          toMinute,
        },
        idempotencyKey,
        ...(targetDeviceId !== undefined ? { targetDeviceId } : {}),
      }),
      201,
    );
  },
);

ownerAnalyticsRoutes.get(
  '/reports/revenue/print/:snapshotId',
  requireActorOrPrintAgent(),
  requirePermission('report.revenue'),
  async (c) =>
    success(
      c,
      await new RevenueReportPrintService(c.env).get(
        c.get('actor').storeId!,
        c.req.param('snapshotId'),
      ),
    ),
);

ownerAnalyticsRoutes.get(
  '/reports/products',
  requireActor('OWNER', 'EMPLOYEE'),
  requirePermission('report.product'),
  async (c) => {
    const storeId = c.get('actor').storeId!;
    const parsed = parseProductReportQuery(c.req.query());
    const result = await new OwnerProductReportService(c.env).getProductReport(storeId, parsed);
    return success(c, result);
  },
);

ownerAnalyticsRoutes.get(
  '/reports/products/:productId/details',
  requireActor('OWNER', 'EMPLOYEE'),
  requirePermission('report.product'),
  async (c) => {
    const storeId = c.get('actor').storeId!;
    const parsed = parseProductReportQuery(c.req.query());
    const result = await new OwnerProductReportService(c.env).getProductDetail(
      storeId,
      c.req.param('productId'),
      parsed,
    );
    return success(c, result);
  },
);

ownerAnalyticsRoutes.post(
  '/reports/products/print',
  requireActor('OWNER', 'EMPLOYEE'),
  async (c) => {
    const body = await parseJson(c.req.raw, printProductReportSchema);
    const actor = c.get('actor');
    await assertPermission(c, 'report.product');
    if (actor.kind !== 'OWNER' && actor.kind !== 'EMPLOYEE') {
      throw new AppError(
        'ACTOR_KIND_UNSUPPORTED',
        'Loại tài khoản không hỗ trợ in báo cáo mặt hàng.',
        403,
      );
    }
    const service = new ProductReportPrintService(c.env, (promise) =>
      c.executionCtx.waitUntil(promise),
    );
    return success(
      c,
      await service.queue({
        storeId: actor.storeId!,
        actorUserId: actor.id,
        actorName: actor.displayName,
        actorKind: actor.kind,
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
        query: body,
        idempotencyKey: body.idempotencyKey,
        ...(body.targetDeviceId !== undefined ? { targetDeviceId: body.targetDeviceId } : {}),
      }),
      201,
    );
  },
);

ownerAnalyticsRoutes.get(
  '/reports/products/print/:snapshotId',
  requireActorOrPrintAgent(),
  requirePermission('report.product'),
  async (c) =>
    success(
      c,
      await new ProductReportPrintService(c.env).get(
        c.get('actor').storeId!,
        c.req.param('snapshotId'),
      ),
    ),
);

export { ownerAnalyticsRoutes };
