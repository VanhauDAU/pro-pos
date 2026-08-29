import type { CreatePrintJobInput, PrintJob, PrintJobQuery } from '@contracts/print-job';
import { AppError } from '@server/lib/app-error';
import { RealtimeDispatcher } from '@server/realtime/realtime-dispatcher';
import { PrintJobRepository } from '@server/repositories/print-job-repository';
import { PushNotificationService } from '@server/services/push-notification-service';

export interface PrintJobAuditContext {
  actorUserId?: string | null;
  actorKind?: 'OWNER' | 'EMPLOYEE' | null;
  deviceId?: string | null;
  requestId?: string | null;
}

const ALLOWED_PRINTER_ROLES = new Set(['receipt', 'temporary_bill', 'kitchen', 'bar']);

function formatPrintDocumentName(documentType: string, printerRole?: string | null): string {
  switch (documentType?.toLowerCase()) {
    case 'provisional':
      return 'phiếu tạm tính';
    case 'invoice':
      return 'hóa đơn';
    case 'debt_payment':
      return 'phiếu thu nợ';
    case 'kitchen':
      return 'phiếu in bếp';
    case 'bar':
      return 'phiếu in pha chế';
    default:
      if (printerRole === 'kitchen') return 'phiếu in bếp';
      if (printerRole === 'bar') return 'phiếu in pha chế';
      return 'tài liệu';
  }
}

export class PrintJobService {
  private readonly repository: PrintJobRepository;
  private readonly dispatcher: RealtimeDispatcher;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new PrintJobRepository(env.DB);
    this.dispatcher = new RealtimeDispatcher(env);
  }

  private async verifyDocumentBelongsToStore(
    storeId: string,
    documentType: string,
    documentId: string,
  ): Promise<void> {
    if (documentType === 'invoice') {
      const row = await this.env.DB.prepare(
        `SELECT id FROM invoices WHERE store_id = ? AND id = ?
         UNION ALL
         SELECT id FROM takeaway_invoices WHERE store_id = ? AND id = ?
         LIMIT 1`,
      )
        .bind(storeId, documentId, storeId, documentId)
        .first<{ id: string }>();
      if (!row) {
        throw new AppError(
          'INVOICE_NOT_FOUND',
          'Hóa đơn không tồn tại hoặc không thuộc cửa hàng.',
          404,
        );
      }
      return;
    }

    if (documentType === 'provisional') {
      const row = await this.env.DB.prepare(
        `SELECT id FROM orders WHERE store_id = ? AND id = ?
         UNION ALL
         SELECT id FROM takeaway_orders WHERE store_id = ? AND id = ?
         LIMIT 1`,
      )
        .bind(storeId, documentId, storeId, documentId)
        .first<{ id: string }>();
      if (!row) {
        throw new AppError(
          'ORDER_NOT_FOUND',
          'Đơn hàng không tồn tại hoặc không thuộc cửa hàng.',
          404,
        );
      }
      return;
    }

    if (documentType === 'debt_payment') {
      const row = await this.env.DB.prepare(
        `SELECT id FROM customer_debt_entries
         WHERE store_id = ? AND entry_type = 'PAYMENT'
           AND (id = ? OR idempotency_key = ? OR reference = ?)
         LIMIT 1`,
      )
        .bind(storeId, documentId, documentId, documentId)
        .first<{ id: string }>();
      if (!row) {
        throw new AppError(
          'DEBT_PAYMENT_NOT_FOUND',
          'Phiếu thu công nợ không tồn tại hoặc không thuộc cửa hàng.',
          404,
        );
      }
      return;
    }

    throw new AppError('INVALID_DOCUMENT_TYPE', 'Loại tài liệu in không hợp lệ.', 400);
  }

  async createPrintJob(
    input: CreatePrintJobInput & {
      storeId: string;
      auditContext?: PrintJobAuditContext;
    },
  ): Promise<PrintJob> {
    const role = input.printerRole.trim().toLowerCase();
    if (!ALLOWED_PRINTER_ROLES.has(role)) {
      throw new AppError(
        'INVALID_PRINTER_ROLE',
        `Vai trò máy in không hợp lệ: ${input.printerRole}`,
        400,
      );
    }

    const existing = await this.repository.getJobByIdempotencyKey(
      input.storeId,
      input.idempotencyKey,
    );
    if (existing) return existing;

    await this.verifyDocumentBelongsToStore(input.storeId, input.documentType, input.documentId);

    const printPolicy = await this.env.DB.prepare(
      `SELECT max_receipt_reprint_count AS maxReceiptReprintCount,
              allow_provisional_print AS allowProvisionalPrint
       FROM store_print_settings WHERE store_id = ? LIMIT 1`,
    )
      .bind(input.storeId)
      .first<{ maxReceiptReprintCount: number; allowProvisionalPrint: number | boolean }>();

    if (input.documentType === 'provisional' && printPolicy && !printPolicy.allowProvisionalPrint) {
      throw new AppError(
        'PROVISIONAL_PRINT_DISABLED',
        'Chủ cửa hàng đã tắt chức năng in hóa đơn tạm tính.',
        403,
      );
    }

    const maxReceiptPrints = Number(printPolicy?.maxReceiptReprintCount ?? 0);
    if (input.documentType === 'invoice' && maxReceiptPrints > 0) {
      const currentPrints = await this.repository.countEffectiveDocumentPrints(
        input.storeId,
        input.documentType,
        input.documentId,
      );
      if (currentPrints >= maxReceiptPrints) {
        throw new AppError(
          'RECEIPT_PRINT_LIMIT_REACHED',
          `Hóa đơn đã đạt giới hạn ${maxReceiptPrints} lần in do chủ cửa hàng thiết lập.`,
          409,
        );
      }
    }

    const now = Date.now();
    const jobId = crypto.randomUUID();

    const { job, isDuplicate } = await this.repository.createJob({
      id: jobId,
      storeId: input.storeId,
      targetDeviceId: input.targetDeviceId ?? null,
      printerRole: role,
      documentType: input.documentType,
      documentId: input.documentId,
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.auditContext?.actorUserId ?? null,
      requestedByDeviceId: input.auditContext?.deviceId ?? null,
      now,
    });

    if (!isDuplicate) {
      const eventId = crypto.randomUUID();
      await this.repository.recordRealtimeEvent({
        eventId,
        storeId: input.storeId,
        eventType: 'pos.print_job.created',
        job,
        reason: 'PRINT_JOB_CREATED',
        actorKind: input.auditContext?.actorKind ?? null,
        actorUserId: input.auditContext?.actorUserId ?? null,
        deviceId: input.auditContext?.deviceId ?? null,
        requestId: input.auditContext?.requestId ?? null,
        now,
      });
      void this.dispatcher.dispatchStore(input.storeId).catch(() => undefined);
    }

    return job;
  }

  async claimPrintJob(
    storeId: string,
    jobId: string,
    claimedByDeviceId: string,
    auditContext?: PrintJobAuditContext,
  ): Promise<PrintJob> {
    const now = Date.now();
    const job = await this.repository.atomicClaim(storeId, jobId, claimedByDeviceId, now);
    if (!job) {
      const existing = await this.repository.getJob(storeId, jobId);
      if (!existing) {
        throw new AppError('PRINT_JOB_NOT_FOUND', 'Yêu cầu in không tồn tại.', 404);
      }
      throw new AppError(
        'PRINT_JOB_CONFLICT',
        `Yêu cầu in đang ở trạng thái ${existing.status}, không thể nhận lệnh.`,
        409,
      );
    }

    const eventId = crypto.randomUUID();
    await this.repository.recordRealtimeEvent({
      eventId,
      storeId,
      eventType: 'pos.print_job.updated',
      job,
      reason: 'PRINT_JOB_CLAIMED',
      actorKind: auditContext?.actorKind ?? null,
      actorUserId: auditContext?.actorUserId ?? null,
      deviceId: claimedByDeviceId,
      requestId: auditContext?.requestId ?? null,
      now,
    });
    void this.dispatcher.dispatchStore(storeId).catch(() => undefined);

    return job;
  }

  async startPrintJob(
    storeId: string,
    jobId: string,
    auditContext?: PrintJobAuditContext,
  ): Promise<PrintJob> {
    const now = Date.now();
    const job = await this.repository.startJob(storeId, jobId, now);
    if (!job) {
      const existing = await this.repository.getJob(storeId, jobId);
      if (!existing) {
        throw new AppError('PRINT_JOB_NOT_FOUND', 'Yêu cầu in không tồn tại.', 404);
      }
      throw new AppError(
        'PRINT_JOB_CONFLICT',
        `Yêu cầu in đang ở trạng thái ${existing.status}, không thể bắt đầu in.`,
        409,
      );
    }

    const eventId = crypto.randomUUID();
    await this.repository.recordRealtimeEvent({
      eventId,
      storeId,
      eventType: 'pos.print_job.updated',
      job,
      reason: 'PRINT_JOB_STARTED',
      actorKind: auditContext?.actorKind ?? null,
      actorUserId: auditContext?.actorUserId ?? null,
      deviceId: auditContext?.deviceId ?? null,
      requestId: auditContext?.requestId ?? null,
      now,
    });
    void this.dispatcher.dispatchStore(storeId).catch(() => undefined);

    return job;
  }

  async completePrintJob(
    storeId: string,
    jobId: string,
    auditContext?: PrintJobAuditContext,
  ): Promise<PrintJob> {
    const now = Date.now();
    const job = await this.repository.completeJob(storeId, jobId, now);
    if (!job) {
      const existing = await this.repository.getJob(storeId, jobId);
      if (!existing) {
        throw new AppError('PRINT_JOB_NOT_FOUND', 'Yêu cầu in không tồn tại.', 404);
      }
      throw new AppError(
        'PRINT_JOB_CONFLICT',
        `Yêu cầu in đang ở trạng thái ${existing.status}, không thể hoàn tất.`,
        409,
      );
    }

    const eventId = crypto.randomUUID();
    await this.repository.recordRealtimeEvent({
      eventId,
      storeId,
      eventType: 'pos.print_job.updated',
      job,
      reason: 'PRINT_JOB_COMPLETED',
      actorKind: auditContext?.actorKind ?? null,
      actorUserId: auditContext?.actorUserId ?? null,
      deviceId: auditContext?.deviceId ?? null,
      requestId: auditContext?.requestId ?? null,
      now,
    });
    void this.dispatcher.dispatchStore(storeId).catch(() => undefined);

    const docName = formatPrintDocumentName(job.documentType, job.printerRole);
    void new PushNotificationService(this.env)
      .sendStoreNotification({
        storeId,
        kind: 'PRINT_COMPLETED',
        soundType: 'NOTIFICATION_CHIME',
        title: 'In thành công',
        body: `Đã in thành công ${docName}.`,
        url: '/pos',
        tag: `print_job_${job.id}`,
        timestamp: now,
      })
      .catch(() => undefined);

    return job;
  }

  async failPrintJob(
    storeId: string,
    jobId: string,
    failureCode: string,
    failureMessage?: string | null,
    auditContext?: PrintJobAuditContext,
  ): Promise<PrintJob> {
    const now = Date.now();
    const job = await this.repository.failJob(
      storeId,
      jobId,
      failureCode,
      failureMessage ?? null,
      now,
    );
    if (!job) {
      const existing = await this.repository.getJob(storeId, jobId);
      if (!existing) {
        throw new AppError('PRINT_JOB_NOT_FOUND', 'Yêu cầu in không tồn tại.', 404);
      }
      throw new AppError(
        'PRINT_JOB_CONFLICT',
        `Yêu cầu in đã hoàn tất, không thể chuyển sang thất bại.`,
        409,
      );
    }

    const eventId = crypto.randomUUID();
    await this.repository.recordRealtimeEvent({
      eventId,
      storeId,
      eventType: 'pos.print_job.updated',
      job,
      reason: 'PRINT_JOB_FAILED',
      actorKind: auditContext?.actorKind ?? null,
      actorUserId: auditContext?.actorUserId ?? null,
      deviceId: auditContext?.deviceId ?? null,
      requestId: auditContext?.requestId ?? null,
      now,
    });
    void this.dispatcher.dispatchStore(storeId).catch(() => undefined);

    const docName = formatPrintDocumentName(job.documentType, job.printerRole);
    const reasonText = failureMessage || 'Lỗi máy in hoặc không thể kết nối';
    void new PushNotificationService(this.env)
      .sendStoreNotification({
        storeId,
        kind: 'PRINT_FAILED',
        soundType: 'NOTIFICATION_CHIME',
        title: 'In thất bại',
        body: `In ${docName} thất bại: ${reasonText}`,
        url: '/pos',
        tag: `print_job_${job.id}`,
        timestamp: now,
      })
      .catch(() => undefined);

    return job;
  }

  async uncertainPrintJob(
    storeId: string,
    jobId: string,
    failureCode?: string | null,
    failureMessage?: string | null,
    auditContext?: PrintJobAuditContext,
  ): Promise<PrintJob> {
    const now = Date.now();
    const job = await this.repository.uncertainJob(
      storeId,
      jobId,
      failureCode ?? 'PRINT_UNCERTAIN',
      failureMessage ?? 'Mất kết nối máy in trong quá trình in',
      now,
    );
    if (!job) {
      const existing = await this.repository.getJob(storeId, jobId);
      if (!existing) {
        throw new AppError('PRINT_JOB_NOT_FOUND', 'Yêu cầu in không tồn tại.', 404);
      }
      throw new AppError(
        'PRINT_JOB_CONFLICT',
        `Yêu cầu in đang ở trạng thái ${existing.status}, không thể chuyển sang không xác định.`,
        409,
      );
    }

    const eventId = crypto.randomUUID();
    await this.repository.recordRealtimeEvent({
      eventId,
      storeId,
      eventType: 'pos.print_job.updated',
      job,
      reason: 'PRINT_JOB_UNCERTAIN',
      actorKind: auditContext?.actorKind ?? null,
      actorUserId: auditContext?.actorUserId ?? null,
      deviceId: auditContext?.deviceId ?? null,
      requestId: auditContext?.requestId ?? null,
      now,
    });
    void this.dispatcher.dispatchStore(storeId).catch(() => undefined);

    const docName = formatPrintDocumentName(job.documentType, job.printerRole);
    void new PushNotificationService(this.env)
      .sendStoreNotification({
        storeId,
        kind: 'PRINT_UNCERTAIN',
        soundType: 'NOTIFICATION_CHIME',
        title: 'Lỗi in không xác định',
        body: `Mất kết nối máy in khi đang in ${docName}.`,
        url: '/pos',
        tag: `print_job_${job.id}`,
        timestamp: now,
      })
      .catch(() => undefined);

    return job;
  }

  async getJob(storeId: string, jobId: string): Promise<PrintJob> {
    const job = await this.repository.getJob(storeId, jobId);
    if (!job) {
      throw new AppError('PRINT_JOB_NOT_FOUND', 'Yêu cầu in không tồn tại.', 404);
    }
    return job;
  }

  async listJobs(storeId: string, query: PrintJobQuery): Promise<PrintJob[]> {
    return this.repository.listJobs(storeId, query.status, query.limit);
  }
}
