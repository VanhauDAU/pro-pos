import type { PrintJob, PrintJobDocumentType, PrintJobStatus } from '@contracts/print-job';

export interface PrintJobRow {
  id: string;
  store_id: string;
  target_device_id: string | null;
  printer_role: string;
  document_type: string;
  document_id: string;
  idempotency_key: string;
  status: PrintJobStatus;
  requested_by_user_id: string | null;
  requested_by_device_id: string | null;
  claimed_by_device_id: string | null;
  created_at: number;
  claimed_at: number | null;
  printing_at: number | null;
  completed_at: number | null;
  failed_at: number | null;
  attempt_count: number;
  failure_code: string | null;
  failure_message: string | null;
}

export function mapPrintJob(row: PrintJobRow): PrintJob {
  return {
    id: row.id,
    storeId: row.store_id,
    targetDeviceId: row.target_device_id,
    printerRole: row.printer_role,
    documentType: row.document_type as PrintJobDocumentType,
    documentId: row.document_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    requestedByUserId: row.requested_by_user_id,
    requestedByDeviceId: row.requested_by_device_id,
    claimedByDeviceId: row.claimed_by_device_id,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    printingAt: row.printing_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    attemptCount: row.attempt_count,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
  };
}

const SELECT_PRINT_JOB = `
  SELECT
    id, store_id, target_device_id, printer_role, document_type, document_id,
    idempotency_key, status, requested_by_user_id, requested_by_device_id,
    claimed_by_device_id, created_at, claimed_at, printing_at, completed_at,
    failed_at, attempt_count, failure_code, failure_message
  FROM print_jobs`;

export class PrintJobRepository {
  constructor(private readonly db: D1Database) {}

  async createJob(params: {
    id: string;
    storeId: string;
    targetDeviceId?: string | null;
    printerRole: string;
    documentType: string;
    documentId: string;
    idempotencyKey: string;
    requestedByUserId?: string | null;
    requestedByDeviceId?: string | null;
    now: number;
  }): Promise<{ job: PrintJob; isDuplicate: boolean }> {
    try {
      const row = await this.db
        .prepare(
          `INSERT INTO print_jobs (
            id, store_id, target_device_id, printer_role, document_type, document_id,
            idempotency_key, status, requested_by_user_id, requested_by_device_id,
            created_at, attempt_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, 0)
          RETURNING *`,
        )
        .bind(
          params.id,
          params.storeId,
          params.targetDeviceId ?? null,
          params.printerRole,
          params.documentType,
          params.documentId,
          params.idempotencyKey,
          params.requestedByUserId ?? null,
          params.requestedByDeviceId ?? null,
          params.now,
        )
        .first<PrintJobRow>();

      if (!row) throw new Error('PRINT_JOB_INSERT_FAILED');
      return { job: mapPrintJob(row), isDuplicate: false };
    } catch (error) {
      // Handle unique constraint conflict on (store_id, idempotency_key)
      const existing = await this.getJobByIdempotencyKey(params.storeId, params.idempotencyKey);
      if (existing) {
        return { job: existing, isDuplicate: true };
      }
      throw error;
    }
  }

  async getJob(storeId: string, jobId: string): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(`${SELECT_PRINT_JOB} WHERE store_id = ? AND id = ? LIMIT 1`)
      .bind(storeId, jobId)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async getJobByIdempotencyKey(storeId: string, idempotencyKey: string): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(`${SELECT_PRINT_JOB} WHERE store_id = ? AND idempotency_key = ? LIMIT 1`)
      .bind(storeId, idempotencyKey)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async countEffectiveDocumentPrints(
    storeId: string,
    documentType: PrintJobDocumentType,
    documentId: string,
  ): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM print_jobs
         WHERE store_id = ? AND document_type = ? AND document_id = ?
           AND status IN ('QUEUED', 'CLAIMED', 'PRINTING', 'COMPLETED', 'UNCERTAIN')`,
      )
      .bind(storeId, documentType, documentId)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  /**
   * Atomically claims a QUEUED job for a specific print bridge device.
   * Returns the updated job if successful, or null if already claimed by another device.
   */
  async atomicClaim(
    storeId: string,
    jobId: string,
    deviceId: string,
    now: number,
  ): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'CLAIMED',
             claimed_by_device_id = ?,
             claimed_at = ?
         WHERE id = ? AND store_id = ? AND status = 'QUEUED'
         RETURNING *`,
      )
      .bind(deviceId, now, jobId, storeId)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async startJob(storeId: string, jobId: string, now: number): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'PRINTING',
             printing_at = ?,
             attempt_count = attempt_count + 1
         WHERE id = ? AND store_id = ? AND status = 'CLAIMED'
         RETURNING *`,
      )
      .bind(now, jobId, storeId)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async completeJob(storeId: string, jobId: string, now: number): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'COMPLETED',
             completed_at = ?
         WHERE id = ? AND store_id = ? AND status IN ('CLAIMED', 'PRINTING')
         RETURNING *`,
      )
      .bind(now, jobId, storeId)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async failJob(
    storeId: string,
    jobId: string,
    failureCode: string,
    failureMessage: string | null,
    now: number,
  ): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'FAILED',
             failure_code = ?,
             failure_message = ?,
             failed_at = ?
         WHERE id = ? AND store_id = ? AND status NOT IN ('COMPLETED')
         RETURNING *`,
      )
      .bind(failureCode, failureMessage ?? null, now, jobId, storeId)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async uncertainJob(
    storeId: string,
    jobId: string,
    failureCode: string,
    failureMessage: string | null,
    now: number,
  ): Promise<PrintJob | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'UNCERTAIN',
             failure_code = ?,
             failure_message = ?,
             failed_at = ?
         WHERE id = ? AND store_id = ? AND status = 'PRINTING'
         RETURNING *`,
      )
      .bind(failureCode, failureMessage ?? null, now, jobId, storeId)
      .first<PrintJobRow>();
    return row ? mapPrintJob(row) : null;
  }

  async listPendingJobs(storeId: string, limit = 50): Promise<PrintJob[]> {
    const result = await this.db
      .prepare(
        `${SELECT_PRINT_JOB}
         WHERE store_id = ? AND status = 'QUEUED'
         ORDER BY created_at ASC LIMIT ?`,
      )
      .bind(storeId, limit)
      .all<PrintJobRow>();
    return result.results.map(mapPrintJob);
  }

  async listJobs(storeId: string, status?: PrintJobStatus, limit = 20): Promise<PrintJob[]> {
    if (status) {
      const result = await this.db
        .prepare(
          `${SELECT_PRINT_JOB}
           WHERE store_id = ? AND status = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(storeId, status, limit)
        .all<PrintJobRow>();
      return result.results.map(mapPrintJob);
    }

    const result = await this.db
      .prepare(
        `${SELECT_PRINT_JOB}
         WHERE store_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(storeId, limit)
      .all<PrintJobRow>();
    return result.results.map(mapPrintJob);
  }

  async recordRealtimeEvent(params: {
    eventId: string;
    storeId: string;
    eventType: 'pos.print_job.created' | 'pos.print_job.updated';
    job: PrintJob;
    reason: string;
    actorKind?: 'OWNER' | 'EMPLOYEE' | null;
    actorUserId?: string | null;
    deviceId?: string | null;
    requestId?: string | null;
    now: number;
  }): Promise<void> {
    const topics = ['pos.print_jobs', `pos.print_job:${params.job.id}`];
    const data = {
      reason: params.reason,
      printJobId: params.job.id,
      printJobStatus: params.job.status,
      targetDeviceId: params.job.targetDeviceId,
      printerRole: params.job.printerRole,
      documentType: params.job.documentType,
      documentId: params.job.documentId,
      claimedByDeviceId: params.job.claimedByDeviceId,
      failureCode: params.job.failureCode,
      failureMessage: params.job.failureMessage,
    };

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO realtime_store_sequences (store_id, last_sequence)
           VALUES (?, 1)
           ON CONFLICT (store_id) DO UPDATE SET
             last_sequence = last_sequence + 1`,
        )
        .bind(params.storeId),
      this.db
        .prepare(
          `INSERT INTO realtime_events (
             event_id, store_id, sequence, schema_version, event_type,
             aggregate_type, aggregate_id, aggregate_version,
             actor_kind, actor_user_id, device_id, client_mutation_id, request_id,
             topics_json, data_json, occurred_at
           ) VALUES (
             ?, ?,
             (SELECT last_sequence FROM realtime_store_sequences WHERE store_id = ?),
             1, 'pos.order.changed', 'ORDER', ?, 1,
             ?,
             (SELECT id FROM users WHERE id = ?),
             (SELECT id FROM devices WHERE id = ?),
             NULL, ?,
             ?, ?, ?
           )`,
        )
        .bind(
          params.eventId,
          params.storeId,
          params.storeId,
          params.job.documentId,
          params.actorKind ?? null,
          params.actorUserId ?? null,
          params.deviceId ?? null,
          params.requestId ?? params.eventId,
          JSON.stringify(topics),
          JSON.stringify(data),
          params.now,
        ),
    ]);
  }

  async cleanupOldJobs(beforeMs: number): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM print_jobs
         WHERE status = 'COMPLETED' AND completed_at < ?`,
      )
      .bind(beforeMs)
      .run();
  }
}
