import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PlatformService } from '@server/services/platform-service';
import { PosService } from '@server/services/pos-service';
import { PrintJobService } from '@server/services/print-job-service';
import { PrintAgentService } from '@server/services/print-agent-service';

describe('Remote Print & Print Agent Lifecycle (Integration Test)', () => {
  let storeId: string;
  let ownerUserId: string;
  let orderId: string;
  let printJobService: PrintJobService;
  let printAgentService: PrintAgentService;

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
    printAgentService = new PrintAgentService(env);
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  describe('Print Agent Pairing & Authentication', () => {
    it('creates 6-digit pairing code, confirms via POS, and verifies agent credentials', async () => {
      // Step 1: Agent requests pairing code
      const session = await printAgentService.createPairingSession();
      expect(session.pairingCode).toMatch(/^\d{6}$/);

      // Step 2: POS owner confirms pairing with 6-digit code
      const confirmed = await printAgentService.confirmPairing(
        session.pairingCode,
        storeId,
        'Mac Quầy Thu Ngân',
      );
      expect(confirmed.agentId).toBeDefined();
      expect(confirmed.deviceName).toBe('Mac Quầy Thu Ngân');

      // Step 3: Agent polls status and receives credentials
      const status = await printAgentService.getPairingStatus(session.sessionId);
      expect(status.status).toBe('APPROVED');
      expect(status.agentId).toBe(confirmed.agentId);
      expect(status.agentSecret).toBeDefined();

      // Step 4: Agent authenticates with credentials
      const agent = await printAgentService.verifyAgent(status.agentId!, status.agentSecret!);
      expect(agent.id).toBe(confirmed.agentId);
      expect(agent.store_id).toBe(storeId);
    });
  });

  describe('Print Job Lifecycle & Multi-Device Safety', () => {
    let jobId: string;
    const idempotencyKey = `print:provisional:${crypto.randomUUID()}`;

    it('creates a print job in QUEUED status for a valid store order', async () => {
      const job = await printJobService.createPrintJob({
        storeId,
        documentType: 'provisional',
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
      expect(job.documentType).toBe('provisional');
      expect(job.documentId).toBe(orderId);
      jobId = job.id;
    });

    it('returns the existing job when re-submitting with identical idempotencyKey', async () => {
      const duplicateJob = await printJobService.createPrintJob({
        storeId,
        documentType: 'provisional',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey,
      });

      expect(duplicateJob.id).toBe(jobId);
    });

    it('allows Print Agent A to atomically claim the job', async () => {
      const claimed = await printJobService.claimPrintJob(storeId, jobId, 'print-agent-mac');
      expect(claimed.status).toBe('CLAIMED');
      expect(claimed.claimedByDeviceId).toBe('print-agent-mac');
    });

    it('rejects Print Agent B when trying to claim the already claimed job (409 Conflict)', async () => {
      await expect(
        printJobService.claimPrintJob(storeId, jobId, 'print-agent-win'),
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
        documentType: 'provisional',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey: failIdemp,
      });

      await printJobService.claimPrintJob(storeId, job.id, 'agent-1');
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
        documentType: 'provisional',
        documentId: orderId,
        printerRole: 'receipt',
        idempotencyKey: uncertainIdemp,
      });

      await printJobService.claimPrintJob(storeId, job.id, 'agent-1');
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
