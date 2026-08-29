import { describe, expect, it, vi } from 'vitest';

import type { PrintJobClaimResponse } from '../../src/contracts/print-job';
import type { AgentApiClient } from '../../apps/print-agent/src/api-client';
import { AgentPrintCache } from '../../apps/print-agent/src/core/print-cache';
import { JobProcessor, type PrintJobTimingSummary } from '../../apps/print-agent/src/job-processor';
import type { PrintJob } from '../../src/contracts/print-job';

describe('Print Agent deterministic performance gate', () => {
  it('keeps hot-cache p95 event-to-TCP below 1s within the fast-path request budget', async () => {
    let clock = 0;
    const getPaths: string[] = [];
    const getBytes = vi.fn();
    const get = vi.fn(async (path: string) => {
      getPaths.push(path);
      if (path === '/api/v1/pos/print-bootstrap') {
        clock += 10;
        return {
          context: { storeName: 'PERFORMANCE STORE' },
          configVersion: 1,
          printSettings: {
            storeId: 'STORE-PERF',
            updatedAt: 1,
            paperSize: 'K80',
            printersJson: JSON.stringify({ networkIp: '192.168.1.10', networkPort: 9100 }),
            paymentCopyCount: 1,
            provisionalCopyCount: 1,
          },
        };
      }
      if (path.startsWith('/api/v1/pos/invoices/INV-')) {
        clock += 30;
        return {
          invoice: {
            id: path.split('/').at(-1),
            displayCode: 'HD-PERF',
            totalVnd: 10000,
            issuedAt: 1720000000000,
          },
          lines: [],
          payment: { method: 'CASH' },
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/claim')) {
        clock += 20;
        return { claimToken: null } satisfies Partial<PrintJobClaimResponse>;
      }
      if (path.endsWith('/start')) clock += 20;
      else if (path.endsWith('/complete')) clock += 10;
      return {};
    });
    const send = vi.fn(async () => {
      clock += 5;
    });
    const api = { get, getBytes, post } as unknown as AgentApiClient;
    const cache = new AgentPrintCache(api, { now: () => clock });
    await cache.prewarm();
    const summaries: PrintJobTimingSummary[] = [];
    const processor = new JobProcessor(
      { serverUrl: 'https://pos.example', agentId: 'AGENT-PERF' },
      api,
      { send },
      cache,
      () => clock,
      () => clock,
      (summary) => summaries.push(summary),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    for (let index = 0; index < 100; index += 1) {
      const eventReceivedAt = clock;
      const job: PrintJob = {
        id: `JOB-${index}`,
        storeId: 'STORE-PERF',
        targetDeviceId: null,
        printerRole: 'receipt',
        documentType: 'invoice',
        documentId: `INV-${index}`,
        idempotencyKey: `perf-${index}`,
        status: 'QUEUED',
        requestedByUserId: null,
        requestedByDeviceId: null,
        claimedByDeviceId: null,
        createdAt: clock,
        claimedAt: null,
        printingAt: null,
        completedAt: null,
        failedAt: null,
        attemptCount: 0,
        failureCode: null,
        failureMessage: null,
        claimLeaseExpiresAt: null,
        claimGeneration: 0,
        claimProtocolVersion: 2,
      };
      await expect(processor.processJob(job, { eventReceivedAt })).resolves.toBe(true);
    }

    const latencies = summaries
      .map((summary) => summary.eventToTcpStartMs ?? Number.POSITIVE_INFINITY)
      .toSorted((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(1_000);
    expect(summaries).toHaveLength(100);
    expect(summaries.every((summary) => summary.cacheStatus === 'HIT')).toBe(true);
    expect(getPaths.filter((path) => path === '/api/v1/pos/print-bootstrap')).toHaveLength(1);
    expect(getPaths.some((path) => /\/print-jobs\/JOB-/.test(path))).toBe(false);
    expect(getBytes).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(100);
    log.mockRestore();
  });
});
