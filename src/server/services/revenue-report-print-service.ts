import type { RevenueReportQuery, RevenueReportPrintSnapshotDto } from '@contracts/revenue-report';
import { AppError } from '@server/lib/app-error';
import { RevenueReportPrintRepository } from '@server/repositories/revenue-report-print-repository';
import { OwnerRevenueReportService } from '@server/services/owner-revenue-report-service';
import { PrintJobService } from '@server/services/print-job-service';
import type { AppEnv } from '@server/types';

const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class RevenueReportPrintService {
  private readonly repository: RevenueReportPrintRepository;

  constructor(
    private readonly env: AppEnv['Bindings'],
    private readonly defer?: (promise: Promise<unknown>) => void,
  ) {
    this.repository = new RevenueReportPrintRepository(env.DB);
  }

  async queue(input: {
    storeId: string;
    actorUserId: string;
    actorName: string;
    actorKind: 'OWNER' | 'EMPLOYEE';
    deviceId: string | null;
    requestId: string;
    query: RevenueReportQuery;
    idempotencyKey: string;
    targetDeviceId?: string | null;
  }) {
    const existing = await this.env.DB.prepare(
      'SELECT id, status FROM print_jobs WHERE store_id = ? AND idempotency_key = ? LIMIT 1',
    )
      .bind(input.storeId, input.idempotencyKey)
      .first<{ id: string; status: string }>();
    if (existing) return { jobId: existing.id, status: existing.status };

    const createdAt = Date.now();
    const report = await new OwnerRevenueReportService(this.env).getRevenueReport(
      input.storeId,
      input.query,
      createdAt,
    );
    const snapshotId = crypto.randomUUID();
    await this.repository.create({
      id: snapshotId,
      storeId: input.storeId,
      requestedByUserId: input.actorUserId,
      requestedByName: input.actorName,
      report,
      createdAt,
      expiresAt: createdAt + SNAPSHOT_TTL_MS,
    });
    const job = await new PrintJobService(this.env, this.defer).createPrintJob({
      storeId: input.storeId,
      documentType: 'revenue_report',
      documentId: snapshotId,
      printerRole: 'receipt',
      targetDeviceId: input.targetDeviceId ?? null,
      idempotencyKey: input.idempotencyKey,
      auditContext: {
        actorUserId: input.actorUserId,
        actorKind: input.actorKind,
        deviceId: input.deviceId,
        requestId: input.requestId,
      },
    });
    return { jobId: job.id, status: job.status };
  }

  async get(storeId: string, snapshotId: string): Promise<RevenueReportPrintSnapshotDto> {
    const snapshot = await this.repository.get(storeId, snapshotId);
    if (!snapshot || snapshot.expiresAt <= Date.now()) {
      throw new AppError(
        'REVENUE_REPORT_SNAPSHOT_NOT_FOUND',
        'Bản in báo cáo không tồn tại hoặc đã hết hạn.',
        404,
      );
    }
    return snapshot;
  }
}
