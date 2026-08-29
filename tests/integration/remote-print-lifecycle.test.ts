import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { PrintJobService } from '@server/services/print-job-service';
import { getDefaultQzCertificate, signQzPayload } from '@server/lib/qz-crypto';
import { TEST_QZ_PRIVATE_KEY_PEM } from '../fixtures/qz-test-keys';

describe('Remote Print & QZ Security Lifecycle (Integration Test)', () => {
  let storeId: string;
  let ownerUserId: string;
  let orderId: string;
  let printJobService: PrintJobService;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    await platform.bootstrap({
      bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
      email: 'system.remote-print@example.com',
      displayName: 'System Remote Print',
    });

    ({ storeId, ownerUserId } = await platform.createStore({
      name: 'Remote Print Cafe',
      ownerDisplayName: 'Store Owner',
      ownerEmail: 'owner.remote-print@example.com',
    }));

    const pos = new PosService(env);
    const order = await pos.createTakeaway({
      storeId,
      actorId: ownerUserId,
      requestId: crypto.randomUUID(),
      idempotencyKey: `init-order-${crypto.randomUUID()}`,
      note: null,
    });
    orderId = order.orderId;
    printJobService = new PrintJobService(env);
  });

  describe('QZ Security & Signing Integration', () => {
    it('provides public certificate and valid RSA-SHA512 signatures', async () => {
      const cert = getDefaultQzCertificate();
      expect(cert).toContain('BEGIN CERTIFICATE');

      const challenge = 'test-challenge-12345';
      const privateKey = (env as any).QZ_PRIVATE_KEY || TEST_QZ_PRIVATE_KEY_PEM;
      const signature = await signQzPayload(challenge, privateKey);
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(64);
    });
  });

  describe('Print Job Lifecycle & Multi-Device Safety', () => {
    let jobId: string;
    const idempotencyKey = `print:order:${crypto.randomUUID()}`;

    it('creates a print job in QUEUED status for a valid store order', async () => {
      const job = await printJobService.createPrintJob({
        storeId,
        documentType: 'order',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey,
        auditContext: {
          actorUserId: ownerUserId,
          actorKind: 'OWNER',
          deviceId: 'mobile-iphone-1',
        },
      });

      expect(job.id).toBeDefined();
      expect(job.status).toBe('QUEUED');
      expect(job.documentType).toBe('order');
      expect(job.documentId).toBe(orderId);
      jobId = job.id;
    });

    it('returns the existing job when re-submitting with identical idempotencyKey', async () => {
      const duplicateJob = await printJobService.createPrintJob({
        storeId,
        documentType: 'order',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey,
      });

      expect(duplicateJob.id).toBe(jobId);
    });

    it('allows Desktop Bridge A to atomically claim the job', async () => {
      const claimed = await printJobService.claimPrintJob(storeId, jobId, 'desktop-mac-counter');
      expect(claimed.status).toBe('CLAIMED');
      expect(claimed.claimedByDeviceId).toBe('desktop-mac-counter');
    });

    it('rejects Desktop Bridge B when trying to claim the already claimed job (409 Conflict)', async () => {
      await expect(
        printJobService.claimPrintJob(storeId, jobId, 'desktop-win-kitchen'),
      ).rejects.toMatchObject({
        code: 'PRINT_JOB_CONFLICT',
        status: 409,
      });
    });

    it('moves from CLAIMED to PRINTING', async () => {
      const printing = await printJobService.startPrintJob(storeId, jobId);
      expect(printing.status).toBe('PRINTING');
      expect(printing.attemptCount).toBe(1);
    });

    it('completes the job and records completion timestamp', async () => {
      const completed = await printJobService.completePrintJob(storeId, jobId);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeGreaterThan(0);

      const fetched = await printJobService.getJob(storeId, jobId);
      expect(fetched.status).toBe('COMPLETED');
    });
  });

  describe('Error handling & Recovery', () => {
    it('handles print failure transition', async () => {
      const failIdemp = `print:fail:${crypto.randomUUID()}`;
      const job = await printJobService.createPrintJob({
        storeId,
        documentType: 'order',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey: failIdemp,
      });

      await printJobService.claimPrintJob(storeId, job.id, 'bridge-1');
      await printJobService.startPrintJob(storeId, job.id);

      const failed = await printJobService.failPrintJob(
        storeId,
        job.id,
        'OUT_OF_PAPER',
        'Máy in hết giấy',
      );
      expect(failed.status).toBe('FAILED');
      expect(failed.failureCode).toBe('OUT_OF_PAPER');
      expect(failed.failureMessage).toBe('Máy in hết giấy');
    });

    it('marks job UNCERTAIN on mid-print disconnection', async () => {
      const uncertainIdemp = `print:uncertain:${crypto.randomUUID()}`;
      const job = await printJobService.createPrintJob({
        storeId,
        documentType: 'order',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey: uncertainIdemp,
      });

      await printJobService.claimPrintJob(storeId, job.id, 'bridge-1');
      await printJobService.startPrintJob(storeId, job.id);

      const uncertain = await printJobService.uncertainPrintJob(
        storeId,
        job.id,
        'COMMUNICATION_TIMEOUT',
        'Mất kết nối với máy in trong khi đang gửi byte ESC/POS',
      );
      expect(uncertain.status).toBe('UNCERTAIN');
      expect(uncertain.failureCode).toBe('COMMUNICATION_TIMEOUT');
    });
  });
});
