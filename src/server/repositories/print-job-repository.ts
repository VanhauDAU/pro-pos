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
  claim_lease_expires_at: number | null;
  claim_generation: number;
  claim_token: string | null;
  claim_protocol_version: number;
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
    claimLeaseExpiresAt: row.claim_lease_expires_at,
    claimGeneration: row.claim_generation,
    claimProtocolVersion: row.claim_protocol_version,
  };
}

const SELECT_PRINT_JOB = `
  SELECT
    id, store_id, target_device_id, printer_role, document_type, document_id,
    idempotency_key, status, requested_by_user_id, requested_by_device_id,
    claimed_by_device_id, created_at, claimed_at, printing_at, completed_at,
    failed_at, attempt_count, failure_code, failure_message,
    claim_lease_expires_at, claim_generation, claim_token, claim_protocol_version
  FROM print_jobs`;

export interface PrintJobTransitionResult {
  job: PrintJob;
  changed: boolean;
  claimToken?: string | null;
}

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
    leaseMs: number,
    protocolVersion: number,
  ): Promise<PrintJobTransitionResult | null> {
    const claimToken = protocolVersion >= 2 ? crypto.randomUUID() : null;
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'CLAIMED',
             claimed_by_device_id = ?,
             claimed_at = ?,
             claim_lease_expires_at = ?,
             claim_generation = claim_generation + 1,
             claim_token = ?,
             claim_protocol_version = ?
         WHERE id = ? AND store_id = ?
           AND (target_device_id IS NULL OR target_device_id = ?)
           AND (
             status = 'QUEUED'
             OR (status = 'CLAIMED' AND claim_lease_expires_at <= ?)
           )
         RETURNING *`,
      )
      .bind(
        deviceId,
        now,
        now + leaseMs,
        claimToken,
        protocolVersion,
        jobId,
        storeId,
        deviceId,
        now,
      )
      .first<PrintJobRow>();
    if (row) return { job: mapPrintJob(row), changed: true, claimToken: row.claim_token };
    const existing = await this.getJobRow(storeId, jobId);
    if (
      existing?.status === 'CLAIMED' &&
      existing.claimed_by_device_id === deviceId &&
      (existing.claim_lease_expires_at ?? 0) > now
    ) {
      return {
        job: mapPrintJob(existing),
        changed: false,
        claimToken: existing.claim_token,
      };
    }
    return null;
  }

  private getJobRow(storeId: string, jobId: string) {
    return this.db
      .prepare(`${SELECT_PRINT_JOB} WHERE store_id = ? AND id = ? LIMIT 1`)
      .bind(storeId, jobId)
      .first<PrintJobRow>();
  }

  private ownsTransition(
    row: PrintJobRow,
    deviceId: string | null,
    claimToken: string | null,
  ): boolean {
    if (deviceId && row.claimed_by_device_id !== deviceId) return false;
    if (row.claim_protocol_version >= 2)
      return Boolean(claimToken && row.claim_token === claimToken);
    return row.claim_token === null;
  }

  async startJob(
    storeId: string,
    jobId: string,
    deviceId: string | null,
    claimToken: string | null,
    now: number,
  ): Promise<PrintJobTransitionResult | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'PRINTING',
             printing_at = ?,
             attempt_count = attempt_count + 1
         WHERE id = ? AND store_id = ? AND status = 'CLAIMED'
           AND claim_lease_expires_at > ?
           AND (? IS NULL OR claimed_by_device_id = ?)
           AND (
             (claim_protocol_version < 2 AND claim_token IS NULL)
             OR (claim_protocol_version >= 2 AND claim_token = ?)
           )
         RETURNING *`,
      )
      .bind(now, jobId, storeId, now, deviceId, deviceId, claimToken)
      .first<PrintJobRow>();
    if (row) return { job: mapPrintJob(row), changed: true };
    const existing = await this.getJobRow(storeId, jobId);
    if (existing?.status === 'PRINTING' && this.ownsTransition(existing, deviceId, claimToken)) {
      return { job: mapPrintJob(existing), changed: false };
    }
    return null;
  }

  async completeJob(
    storeId: string,
    jobId: string,
    deviceId: string | null,
    claimToken: string | null,
    now: number,
  ): Promise<PrintJobTransitionResult | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'COMPLETED',
             completed_at = ?
         WHERE id = ? AND store_id = ? AND status = 'PRINTING'
           AND (? IS NULL OR claimed_by_device_id = ?)
           AND (
             (claim_protocol_version < 2 AND claim_token IS NULL)
             OR (claim_protocol_version >= 2 AND claim_token = ?)
           )
         RETURNING *`,
      )
      .bind(now, jobId, storeId, deviceId, deviceId, claimToken)
      .first<PrintJobRow>();
    if (row) return { job: mapPrintJob(row), changed: true };
    const existing = await this.getJobRow(storeId, jobId);
    if (existing?.status === 'COMPLETED' && this.ownsTransition(existing, deviceId, claimToken)) {
      return { job: mapPrintJob(existing), changed: false };
    }
    return null;
  }

  async failJob(
    storeId: string,
    jobId: string,
    failureCode: string,
    failureMessage: string | null,
    deviceId: string | null,
    claimToken: string | null,
    now: number,
  ): Promise<PrintJobTransitionResult | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'FAILED',
             failure_code = ?,
             failure_message = ?,
             failed_at = ?
         WHERE id = ? AND store_id = ? AND status IN ('CLAIMED', 'PRINTING')
           AND (status = 'PRINTING' OR claim_lease_expires_at > ?)
           AND (? IS NULL OR claimed_by_device_id = ?)
           AND (
             (claim_protocol_version < 2 AND claim_token IS NULL)
             OR (claim_protocol_version >= 2 AND claim_token = ?)
           )
         RETURNING *`,
      )
      .bind(
        failureCode,
        failureMessage ?? null,
        now,
        jobId,
        storeId,
        now,
        deviceId,
        deviceId,
        claimToken,
      )
      .first<PrintJobRow>();
    if (row) return { job: mapPrintJob(row), changed: true };
    const existing = await this.getJobRow(storeId, jobId);
    if (existing?.status === 'FAILED' && this.ownsTransition(existing, deviceId, claimToken)) {
      return { job: mapPrintJob(existing), changed: false };
    }
    return null;
  }

  async uncertainJob(
    storeId: string,
    jobId: string,
    failureCode: string,
    failureMessage: string | null,
    deviceId: string | null,
    claimToken: string | null,
    now: number,
  ): Promise<PrintJobTransitionResult | null> {
    const row = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'UNCERTAIN',
             failure_code = ?,
             failure_message = ?,
             failed_at = ?
         WHERE id = ? AND store_id = ? AND status = 'PRINTING'
           AND (? IS NULL OR claimed_by_device_id = ?)
           AND (
             (claim_protocol_version < 2 AND claim_token IS NULL)
             OR (claim_protocol_version >= 2 AND claim_token = ?)
           )
         RETURNING *`,
      )
      .bind(
        failureCode,
        failureMessage ?? null,
        now,
        jobId,
        storeId,
        deviceId,
        deviceId,
        claimToken,
      )
      .first<PrintJobRow>();
    if (row) return { job: mapPrintJob(row), changed: true };
    const existing = await this.getJobRow(storeId, jobId);
    if (existing?.status === 'UNCERTAIN' && this.ownsTransition(existing, deviceId, claimToken)) {
      return { job: mapPrintJob(existing), changed: false };
    }
    return null;
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

  async listPendingJobsForAgent(
    storeId: string,
    agentId: string,
    now: number,
    limit: number,
    cursor?: { createdAt: number; id: string } | undefined,
  ): Promise<PrintJob[]> {
    const cursorCreatedAt = cursor?.createdAt ?? -1;
    const cursorId = cursor?.id ?? '';
    const result = await this.db
      .prepare(
        `${SELECT_PRINT_JOB}
         WHERE store_id = ?
           AND (target_device_id IS NULL OR target_device_id = ?)
           AND (
             status = 'QUEUED'
             OR (status = 'CLAIMED' AND claim_lease_expires_at <= ?)
           )
           AND (created_at > ? OR (created_at = ? AND id > ?))
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(storeId, agentId, now, cursorCreatedAt, cursorCreatedAt, cursorId, limit)
      .all<PrintJobRow>();
    return result.results.map(mapPrintJob);
  }

  async markStalePrintingUncertain(
    storeId: string,
    printingBefore: number,
    now: number,
    claimedByDeviceId?: string | null,
  ): Promise<PrintJob[]> {
    const result = await this.db
      .prepare(
        `UPDATE print_jobs
         SET status = 'UNCERTAIN',
             failure_code = 'PRINT_AGENT_CRASH_TIMEOUT',
             failure_message = 'Print Agent không xác nhận kết quả sau khi bắt đầu in.',
             failed_at = ?
         WHERE store_id = ? AND status = 'PRINTING' AND printing_at <= ?
           AND (? IS NULL OR claimed_by_device_id = ?)
         RETURNING *`,
      )
      .bind(now, storeId, printingBefore, claimedByDeviceId ?? null, claimedByDeviceId ?? null)
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
      printJob: params.job,
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
             1, ?, 'PRINT_JOB', ?, 1,
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
          params.eventType,
          params.job.id,
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
