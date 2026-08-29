import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrintJobService } from '../../src/server/services/print-job-service';

function createMockDb(
  printPolicy: { maxReceiptReprintCount?: number; allowProvisionalPrint?: boolean } = {},
) {
  const printJobs = new Map<string, any>();
  const idempotencyMap = new Map<string, any>();
  const invoices = new Set<string>(['store-1:inv-100', 'store-1:inv-200']);
  const orders = new Set<string>(['store-1:ord-100', 'store-1:ord-200']);

  return {
    printJobsForTest: printJobs,
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first<T = any>(): Promise<T | null> {
              if (sql.includes('FROM store_print_settings')) {
                return {
                  maxReceiptReprintCount: printPolicy.maxReceiptReprintCount ?? 0,
                  allowProvisionalPrint: printPolicy.allowProvisionalPrint ?? true,
                } as T;
              }
              if (sql.includes('COUNT(*) AS total') && sql.includes('FROM print_jobs')) {
                const [storeId, documentType, documentId] = args;
                const effectiveStatuses = new Set([
                  'QUEUED',
                  'CLAIMED',
                  'PRINTING',
                  'COMPLETED',
                  'UNCERTAIN',
                ]);
                const total = Array.from(printJobs.values()).filter(
                  (job) =>
                    job.store_id === storeId &&
                    job.document_type === documentType &&
                    job.document_id === documentId &&
                    effectiveStatuses.has(job.status),
                ).length;
                return { total } as T;
              }
              if (sql.includes('FROM invoices') || sql.includes('FROM takeaway_invoices')) {
                const [storeId, docId] = args;
                if (invoices.has(`${storeId}:${docId}`)) {
                  return { id: docId } as T;
                }
                return null;
              }
              if (sql.includes('FROM orders') || sql.includes('FROM takeaway_orders')) {
                const [storeId, docId] = args;
                if (orders.has(`${storeId}:${docId}`)) {
                  return { id: docId } as T;
                }
                return null;
              }
              if (sql.includes('INSERT INTO print_jobs')) {
                const [
                  id,
                  storeId,
                  targetDeviceId,
                  printerRole,
                  documentType,
                  documentId,
                  idempotencyKey,
                  requestedByUserId,
                  requestedByDeviceId,
                  createdAt,
                ] = args;
                const key = `${storeId}:${idempotencyKey}`;
                if (idempotencyMap.has(key)) {
                  throw new Error(
                    'UNIQUE constraint failed: print_jobs.store_id, print_jobs.idempotency_key',
                  );
                }
                const job = {
                  id,
                  store_id: storeId,
                  target_device_id: targetDeviceId,
                  printer_role: printerRole,
                  document_type: documentType,
                  document_id: documentId,
                  idempotency_key: idempotencyKey,
                  status: 'QUEUED',
                  requested_by_user_id: requestedByUserId,
                  requested_by_device_id: requestedByDeviceId,
                  claimed_by_device_id: null,
                  created_at: createdAt,
                  claimed_at: null,
                  printing_at: null,
                  completed_at: null,
                  failed_at: null,
                  attempt_count: 0,
                  failure_code: null,
                  failure_message: null,
                  claim_lease_expires_at: null,
                  claim_generation: 0,
                  claim_token: null,
                  claim_protocol_version: 1,
                };
                printJobs.set(id, job);
                idempotencyMap.set(key, job);
                return job as T;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'QUEUED'")) {
                const [deviceId, now, leaseExpiresAt, claimToken, protocolVersion, jobId, storeId] =
                  args;
                const job = printJobs.get(jobId);
                if (
                  job &&
                  job.store_id === storeId &&
                  (job.status === 'QUEUED' ||
                    (job.status === 'CLAIMED' && job.claim_lease_expires_at <= now))
                ) {
                  job.status = 'CLAIMED';
                  job.claimed_by_device_id = deviceId;
                  job.claimed_at = now;
                  job.claim_lease_expires_at = leaseExpiresAt;
                  job.claim_generation += 1;
                  job.claim_token = claimToken;
                  job.claim_protocol_version = protocolVersion;
                  return job as T;
                }
                return null;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'CLAIMED'")) {
                const [now, jobId, storeId, leaseNow, deviceId, _deviceIdAgain, claimToken] = args;
                const job = printJobs.get(jobId);
                if (
                  job &&
                  job.store_id === storeId &&
                  job.status === 'CLAIMED' &&
                  job.claim_lease_expires_at > leaseNow &&
                  (!deviceId || job.claimed_by_device_id === deviceId) &&
                  (job.claim_protocol_version < 2 || job.claim_token === claimToken)
                ) {
                  job.status = 'PRINTING';
                  job.printing_at = now;
                  job.attempt_count += 1;
                  return job as T;
                }
                return null;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'COMPLETED'")) {
                const [now, jobId, storeId] = args;
                const job = printJobs.get(jobId);
                if (
                  job &&
                  job.store_id === storeId &&
                  (job.status === 'CLAIMED' || job.status === 'PRINTING')
                ) {
                  job.status = 'COMPLETED';
                  job.completed_at = now;
                  return job as T;
                }
                return null;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'FAILED'")) {
                const [failureCode, failureMessage, now, jobId, storeId] = args;
                const job = printJobs.get(jobId);
                if (job && job.store_id === storeId && job.status !== 'COMPLETED') {
                  job.status = 'FAILED';
                  job.failure_code = failureCode;
                  job.failure_message = failureMessage;
                  job.failed_at = now;
                  return job as T;
                }
                return null;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'UNCERTAIN'")) {
                const [failureCode, failureMessage, now, jobId, storeId] = args;
                const job = printJobs.get(jobId);
                if (job && job.store_id === storeId && job.status === 'PRINTING') {
                  job.status = 'UNCERTAIN';
                  job.failure_code = failureCode;
                  job.failure_message = failureMessage;
                  job.failed_at = now;
                  return job as T;
                }
                return null;
              }
              if (sql.includes('SELECT') && sql.includes('WHERE store_id = ? AND id = ?')) {
                const [storeId, jobId] = args;
                const job = printJobs.get(jobId);
                if (job && job.store_id === storeId) return job as T;
                return null;
              }
              if (
                sql.includes('SELECT') &&
                sql.includes('WHERE store_id = ? AND idempotency_key = ?')
              ) {
                const [storeId, idempotencyKey] = args;
                const job = idempotencyMap.get(`${storeId}:${idempotencyKey}`);
                if (job) return job as T;
                return null;
              }
              return null;
            },
            async all<T = any>() {
              return { results: Array.from(printJobs.values()) as T[] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

describe('PrintJobService', () => {
  let db: any;
  let service: PrintJobService;

  beforeEach(() => {
    db = createMockDb();
    const env = {
      DB: db,
      STORE_REALTIME: {
        getByName: vi.fn(() => ({
          broadcast: vi.fn(async () => ({ deliveredConnections: 1 })),
        })),
      },
    } as unknown as CloudflareBindings;
    service = new PrintJobService(env);
  });

  it('creates a print job with QUEUED status when document exists', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'invoice',
      documentId: 'inv-100',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-1',
    });

    expect(job.id).toBeDefined();
    expect(job.status).toBe('QUEUED');
    expect(job.documentType).toBe('invoice');
    expect(job.documentId).toBe('inv-100');
  });

  it('rejects print job creation if document does not belong to store', async () => {
    await expect(
      service.createPrintJob({
        storeId: 'store-1',
        documentType: 'invoice',
        documentId: 'inv-unknown',
        printerRole: 'receipt',
        idempotencyKey: 'idemp-2',
      }),
    ).rejects.toMatchObject({
      code: 'INVOICE_NOT_FOUND',
      status: 404,
    });
  });

  it('does not accept an order id for an invoice print job', async () => {
    await expect(
      service.createPrintJob({
        storeId: 'store-1',
        documentType: 'invoice',
        documentId: 'ord-100',
        printerRole: 'receipt',
        idempotencyKey: 'idemp-invoice-order-mismatch',
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND', status: 404 });
  });

  it('returns existing print job on duplicate idempotency key without duplicate creation', async () => {
    const job1 = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'invoice',
      documentId: 'inv-100',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-duplicate',
    });

    const job2 = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'invoice',
      documentId: 'inv-100',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-duplicate',
    });

    expect(job2.id).toBe(job1.id);
  });

  it('enforces the Owner provisional-print switch on the server', async () => {
    const policyDb = createMockDb({ allowProvisionalPrint: false });
    const policyService = new PrintJobService({
      DB: policyDb,
      STORE_REALTIME: {
        getByName: vi.fn(() => ({ broadcast: vi.fn(async () => ({ deliveredConnections: 1 })) })),
      },
    } as unknown as CloudflareBindings);

    await expect(
      policyService.createPrintJob({
        storeId: 'store-1',
        documentType: 'provisional',
        documentId: 'ord-100',
        printerRole: 'receipt',
        idempotencyKey: 'disabled-provisional',
      }),
    ).rejects.toMatchObject({ code: 'PROVISIONAL_PRINT_DISABLED', status: 403 });
  });

  it('enforces the Owner receipt print limit while preserving idempotent retries', async () => {
    const policyDb = createMockDb({ maxReceiptReprintCount: 2 });
    const policyService = new PrintJobService({
      DB: policyDb,
      STORE_REALTIME: {
        getByName: vi.fn(() => ({ broadcast: vi.fn(async () => ({ deliveredConnections: 1 })) })),
      },
    } as unknown as CloudflareBindings);
    const request = {
      storeId: 'store-1',
      documentType: 'invoice' as const,
      documentId: 'inv-100',
      printerRole: 'receipt',
    };

    const first = await policyService.createPrintJob({ ...request, idempotencyKey: 'limit-1' });
    await policyService.createPrintJob({ ...request, idempotencyKey: 'limit-2' });
    await expect(
      policyService.createPrintJob({ ...request, idempotencyKey: 'limit-3' }),
    ).rejects.toMatchObject({ code: 'RECEIPT_PRINT_LIMIT_REACHED', status: 409 });
    await expect(
      policyService.createPrintJob({ ...request, idempotencyKey: 'limit-1' }),
    ).resolves.toMatchObject({ id: first.id });
  });

  it('handles atomic claim so that only one device wins and the other gets 409 conflict', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'provisional',
      documentId: 'ord-100',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-claim-race',
    });

    // Mac A claims job
    const macAJob = await service.claimPrintJob('store-1', job.id, 'mac-device-a');
    expect(macAJob.status).toBe('CLAIMED');
    expect(macAJob.claimedByDeviceId).toBe('mac-device-a');

    // Windows B tries to claim the same job -> conflict
    await expect(service.claimPrintJob('store-1', job.id, 'win-device-b')).rejects.toMatchObject({
      code: 'PRINT_JOB_CONFLICT',
      status: 409,
    });
  });

  it('returns the same fenced lease for a retry and rejects stale tokens after reclaim', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'provisional',
      documentId: 'ord-100',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-fenced-claim',
    });
    const deviceA = {
      actorUserId: 'agent-a',
      actorKind: 'EMPLOYEE' as const,
      deviceId: 'agent-a',
    };
    const first = await service.claimPrintJob('store-1', job.id, 'agent-a', deviceA, 2);
    const retry = await service.claimPrintJob('store-1', job.id, 'agent-a', deviceA, 2);
    expect(retry.claimToken).toBe(first.claimToken);
    expect(retry.claimGeneration).toBe(first.claimGeneration);

    db.printJobsForTest.get(job.id).claim_lease_expires_at = Date.now() - 1;
    const deviceB = {
      actorUserId: 'agent-b',
      actorKind: 'EMPLOYEE' as const,
      deviceId: 'agent-b',
    };
    const reclaimed = await service.claimPrintJob('store-1', job.id, 'agent-b', deviceB, 2);
    expect(reclaimed.claimGeneration).toBe(first.claimGeneration + 1);
    expect(reclaimed.claimToken).not.toBe(first.claimToken);

    await expect(
      service.startPrintJob('store-1', job.id, deviceA, first.claimToken),
    ).rejects.toMatchObject({ code: 'PRINT_JOB_CONFLICT', status: 409 });
    const printing = await service.startPrintJob('store-1', job.id, deviceB, reclaimed.claimToken);
    expect(printing.status).toBe('PRINTING');
    await expect(
      service.startPrintJob('store-1', job.id, deviceB, reclaimed.claimToken),
    ).resolves.toMatchObject({ status: 'PRINTING' });
  });

  it('makes completion idempotent for the same agent and claim token', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'invoice',
      documentId: 'inv-200',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-complete-retry',
    });
    const audit = {
      actorUserId: 'agent-a',
      actorKind: 'EMPLOYEE' as const,
      deviceId: 'agent-a',
    };
    const claim = await service.claimPrintJob('store-1', job.id, 'agent-a', audit, 2);
    await service.startPrintJob('store-1', job.id, audit, claim.claimToken);
    const completed = await service.completePrintJob('store-1', job.id, audit, claim.claimToken);
    const retry = await service.completePrintJob('store-1', job.id, audit, claim.claimToken);
    expect(retry).toEqual(completed);
  });

  it('progresses lifecycle: CLAIMED -> PRINTING -> COMPLETED', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'provisional',
      documentId: 'ord-200',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-flow',
    });

    await service.claimPrintJob('store-1', job.id, 'bridge-1');
    const printing = await service.startPrintJob('store-1', job.id);
    expect(printing.status).toBe('PRINTING');
    expect(printing.attemptCount).toBe(1);

    const completed = await service.completePrintJob('store-1', job.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBeGreaterThan(0);
  });

  it('marks FAILED when error occurs and does not allow completed job to fail', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'invoice',
      documentId: 'inv-200',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-fail',
    });

    await service.claimPrintJob('store-1', job.id, 'bridge-1');
    await service.startPrintJob('store-1', job.id);

    const failed = await service.failPrintJob(
      'store-1',
      job.id,
      'PRINTER_OFFLINE',
      'Máy in bị mất nguồn',
    );
    expect(failed.status).toBe('FAILED');
    expect(failed.failureCode).toBe('PRINTER_OFFLINE');
    expect(failed.failureMessage).toBe('Máy in bị mất nguồn');
  });

  it('marks UNCERTAIN on crash/disconnect during PRINTING and prevents auto-restart', async () => {
    const job = await service.createPrintJob({
      storeId: 'store-1',
      documentType: 'invoice',
      documentId: 'inv-100',
      printerRole: 'receipt',
      idempotencyKey: 'idemp-uncertain',
    });

    await service.claimPrintJob('store-1', job.id, 'bridge-1');
    await service.startPrintJob('store-1', job.id);

    const uncertain = await service.uncertainPrintJob(
      'store-1',
      job.id,
      'PRINTER_DISCONNECTED',
      'Mất kết nối máy in khi đang in',
    );
    expect(uncertain.status).toBe('UNCERTAIN');
    expect(uncertain.failureCode).toBe('PRINTER_DISCONNECTED');
  });
});
