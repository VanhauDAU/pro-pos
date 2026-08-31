import type { ProductReportPrintSnapshotDto, ProductReportQueryInput } from '@contracts/reports';
import { AppError } from '@server/lib/app-error';
import { ProductReportPrintRepository } from '@server/repositories/product-report-print-repository';
import { OwnerProductReportService } from '@server/services/owner-product-report-service';
import { PrintJobService } from '@server/services/print-job-service';
import type { AppEnv } from '@server/types';

const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class ProductReportPrintService {
  private readonly repository: ProductReportPrintRepository;

  constructor(
    private readonly env: AppEnv['Bindings'],
    private readonly defer?: (promise: Promise<unknown>) => void,
  ) {
    this.repository = new ProductReportPrintRepository(env.DB);
  }

  async queue(input: {
    storeId: string;
    actorUserId: string;
    actorName: string;
    actorKind: 'OWNER' | 'EMPLOYEE';
    deviceId: string | null;
    requestId: string;
    query: ProductReportQueryInput;
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
    const report = await new OwnerProductReportService(this.env).getProductReport(
      input.storeId,
      input.query,
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
      documentType: 'product_report',
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

  async get(storeId: string, snapshotId: string): Promise<ProductReportPrintSnapshotDto> {
    const snapshot = await this.repository.get(storeId, snapshotId);
    if (!snapshot || snapshot.expiresAt <= Date.now()) {
      throw new AppError(
        'PRODUCT_REPORT_SNAPSHOT_NOT_FOUND',
        'Bản in báo cáo mặt hàng không tồn tại hoặc đã hết hạn.',
        404,
      );
    }
    return snapshot;
  }
}
