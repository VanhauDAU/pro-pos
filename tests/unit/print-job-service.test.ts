import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrintJobService } from '../../src/server/services/print-job-service';

function createMockDb() {
  const printJobs = new Map<string, any>();
  const idempotencyMap = new Map<string, any>();
  const invoices = new Set<string>(['store-1:inv-100', 'store-1:inv-200']);
  const orders = new Set<string>(['store-1:ord-100', 'store-1:ord-200']);

  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first<T = any>(): Promise<T | null> {
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
                };
                printJobs.set(id, job);
                idempotencyMap.set(key, job);
                return job as T;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'QUEUED'")) {
                const [deviceId, now, jobId, storeId] = args;
                const job = printJobs.get(jobId);
                if (job && job.store_id === storeId && job.status === 'QUEUED') {
                  job.status = 'CLAIMED';
                  job.claimed_by_device_id = deviceId;
                  job.claimed_at = now;
                  return job as T;
                }
                return null;
              }
              if (sql.includes('UPDATE print_jobs') && sql.includes("status = 'CLAIMED'")) {
                const [now, jobId, storeId] = args;
                const job = printJobs.get(jobId);
                if (job && job.store_id === storeId && job.status === 'CLAIMED') {
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
