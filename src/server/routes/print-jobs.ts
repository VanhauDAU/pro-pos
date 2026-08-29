import { Hono } from 'hono';

import {
  claimPrintJobSchema,
  createPrintJobSchema,
  failPrintJobSchema,
  printJobQuerySchema,
  transitionPrintJobSchema,
} from '@contracts/print-job';
import { orderWorkspacePermissionKeys } from '@contracts/staff';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActorOrPrintAgent, requirePermission } from '@server/middleware/authorization';
import { PrintJobService } from '@server/services/print-job-service';
import type { AppEnv } from '@server/types';

export const printJobRoutes = new Hono<AppEnv>();

printJobRoutes.use('*', requireActorOrPrintAgent());

/**
 * POST /api/v1/pos/print-jobs
 * Mobile/iPad tạo yêu cầu in hóa đơn hoặc phiếu tạm tính.
 */
printJobRoutes.post(
  '/',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    const body = await parseJson(c.req.raw, createPrintJobSchema);
    const actor = c.get('actor');
    const device = c.get('device');
    const service = new PrintJobService(c.env);

    const job = await service.createPrintJob({
      ...body,
      storeId: actor.storeId!,
      auditContext: {
        actorUserId: actor.id,
        actorKind: actor.kind as 'OWNER' | 'EMPLOYEE',
        deviceId: device?.id ?? null,
        requestId: c.get('requestId'),
      },
    });

    return success(c, { jobId: job.id, status: job.status }, 201);
  },
);

/**
 * GET /api/v1/pos/print-jobs
 * Lấy danh sách yêu cầu in (có thể lọc theo status, ví dụ QUEUED để recovery).
 */
printJobRoutes.get(
  '/',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    const query = printJobQuerySchema.parse(c.req.query());
    const actor = c.get('actor');
    const service = new PrintJobService(c.env);
    const jobs = await service.listJobs(actor.storeId!, query);
    return success(c, jobs);
  },
);

/**
 * GET /api/v1/pos/print-jobs/:id
 * Lấy chi tiết trạng thái của một yêu cầu in.
 */
printJobRoutes.get(
  '/:id',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    const actor = c.get('actor');
    const service = new PrintJobService(c.env);
    const job = await service.getJob(actor.storeId!, c.req.param('id'));
    return success(c, job);
  },
);

/**
 * POST /api/v1/pos/print-jobs/:id/claim
 * Desktop Print Bridge nhận (claim) yêu cầu in atomically.
 */
printJobRoutes.post(
  '/:id/claim',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    let claimedByDeviceId: string | undefined;
    try {
      const body = await parseJson(c.req.raw, claimPrintJobSchema);
      claimedByDeviceId = body.claimedByDeviceId;
    } catch {
      // Body is optional
    }

    const actor = c.get('actor');
    const device = c.get('device');
    const isPrintAgent = Boolean(c.req.header('X-Agent-Id'));
    const finalClaimedByDeviceId = isPrintAgent
      ? device?.id || actor.id
      : claimedByDeviceId?.trim() || device?.id || actor.id || 'desktop-bridge';
    const protocolVersion = isPrintAgent && c.req.header('X-Print-Agent-Protocol') === '2' ? 2 : 1;

    const service = new PrintJobService(c.env);
    const job = await service.claimPrintJob(
      actor.storeId!,
      c.req.param('id'),
      finalClaimedByDeviceId,
      {
        actorUserId: actor.id,
        actorKind: actor.kind as 'OWNER' | 'EMPLOYEE',
        deviceId: device?.id ?? null,
        requestId: c.get('requestId'),
      },
      protocolVersion,
    );

    return success(c, job);
  },
);

/**
 * POST /api/v1/pos/print-jobs/:id/start
 * Desktop Print Bridge thông báo bắt đầu in.
 */
printJobRoutes.post(
  '/:id/start',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    let claimToken: string | undefined;
    try {
      claimToken = (await parseJson(c.req.raw, transitionPrintJobSchema)).claimToken;
    } catch {
      // Legacy agents send an empty body.
    }
    const actor = c.get('actor');
    const device = c.get('device');
    const service = new PrintJobService(c.env);

    const job = await service.startPrintJob(
      actor.storeId!,
      c.req.param('id'),
      {
        actorUserId: actor.id,
        actorKind: actor.kind as 'OWNER' | 'EMPLOYEE',
        deviceId: device?.id ?? null,
        requestId: c.get('requestId'),
      },
      claimToken ?? null,
    );

    return success(c, job);
  },
);

/**
 * POST /api/v1/pos/print-jobs/:id/complete
 * Desktop Print Bridge thông báo in thành công.
 */
printJobRoutes.post(
  '/:id/complete',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    let claimToken: string | undefined;
    try {
      claimToken = (await parseJson(c.req.raw, transitionPrintJobSchema)).claimToken;
    } catch {
      // Legacy agents send an empty body.
    }
    const actor = c.get('actor');
    const device = c.get('device');
    const service = new PrintJobService(c.env);

    const job = await service.completePrintJob(
      actor.storeId!,
      c.req.param('id'),
      {
        actorUserId: actor.id,
        actorKind: actor.kind as 'OWNER' | 'EMPLOYEE',
        deviceId: device?.id ?? null,
        requestId: c.get('requestId'),
      },
      claimToken ?? null,
    );

    return success(c, job);
  },
);

/**
 * POST /api/v1/pos/print-jobs/:id/fail
 * Desktop Print Bridge thông báo in thất bại kèm mã lỗi.
 */
printJobRoutes.post(
  '/:id/fail',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    const body = await parseJson(c.req.raw, failPrintJobSchema);
    const actor = c.get('actor');
    const device = c.get('device');
    const service = new PrintJobService(c.env);

    const job = await service.failPrintJob(
      actor.storeId!,
      c.req.param('id'),
      body.failureCode,
      body.failureMessage,
      {
        actorUserId: actor.id,
        actorKind: actor.kind as 'OWNER' | 'EMPLOYEE',
        deviceId: device?.id ?? null,
        requestId: c.get('requestId'),
      },
      body.claimToken ?? null,
    );

    return success(c, job);
  },
);

/**
 * POST /api/v1/pos/print-jobs/:id/uncertain
 * Đánh dấu trạng thái không xác định khi crash/mất kết nối trong quá trình PRINTING.
 */
printJobRoutes.post(
  '/:id/uncertain',
  requirePermission(...orderWorkspacePermissionKeys, 'order.proforma_print', 'invoice.print'),
  async (c) => {
    let failureCode: string | undefined;
    let failureMessage: string | undefined;
    let claimToken: string | undefined;
    try {
      const body = await parseJson(c.req.raw, failPrintJobSchema);
      failureCode = body.failureCode;
      failureMessage = body.failureMessage;
      claimToken = body.claimToken;
    } catch {
      // Agent versions prior to the failure-boundary update send no body.
    }
    const actor = c.get('actor');
    const device = c.get('device');
    const service = new PrintJobService(c.env);

    const job = await service.uncertainPrintJob(
      actor.storeId!,
      c.req.param('id'),
      failureCode ?? 'PRINT_UNCERTAIN',
      failureMessage ?? 'Mất kết nối máy in trong quá trình in',
      {
        actorUserId: actor.id,
        actorKind: actor.kind as 'OWNER' | 'EMPLOYEE',
        deviceId: device?.id ?? null,
        requestId: c.get('requestId'),
      },
      claimToken ?? null,
    );

    return success(c, job);
  },
);
