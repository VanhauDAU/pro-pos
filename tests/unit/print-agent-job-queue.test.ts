import { describe, expect, it } from 'vitest';
import { JobQueue } from '../../apps/print-agent/src/job-queue';

const noop = () => {};

describe('JobQueue Graceful Drain and Idle Tests', () => {
  it('waitForIdle resolves immediately when queue is empty', async () => {
    const queue = new JobQueue();
    expect(queue.isIdle()).toBe(true);
    expect(queue.getPendingCount()).toBe(0);

    const idle = await queue.waitForIdle(1000);
    expect(idle).toBe(true);
  });

  it('waitForIdle waits for running and queued jobs to complete', async () => {
    const queue = new JobQueue();
    const executed: string[] = [];

    let resolveJob1: () => void = noop;
    const job1Promise = new Promise<void>((r) => {
      resolveJob1 = r;
    });

    let resolveJob2: () => void = noop;
    const job2Promise = new Promise<void>((r) => {
      resolveJob2 = r;
    });

    queue.enqueue('printer-1', async () => {
      await job1Promise;
      executed.push('job1');
    });

    queue.enqueue('printer-1', async () => {
      await job2Promise;
      executed.push('job2');
    });

    expect(queue.isIdle()).toBe(false);
    expect(queue.getPendingCount()).toBe(2);

    let idleResolved = false;
    const waitPromise = queue.waitForIdle(5000).then((res) => {
      idleResolved = res;
    });

    expect(idleResolved).toBe(false);

    // Complete job 1
    resolveJob1();
    await new Promise((r) => setTimeout(r, 10));
    expect(executed).toEqual(['job1']);
    expect(queue.getPendingCount()).toBe(1);
    expect(idleResolved).toBe(false);

    // Complete job 2
    resolveJob2();
    await waitPromise;

    expect(executed).toEqual(['job1', 'job2']);
    expect(queue.isIdle()).toBe(true);
    expect(idleResolved).toBe(true);
  });

  it('waitForIdle returns false on timeout if job remains stuck', async () => {
    const queue = new JobQueue();

    // Never resolving job
    queue.enqueue('printer-1', () => new Promise<void>(() => {}));

    expect(queue.isIdle()).toBe(false);

    const isIdle = await queue.waitForIdle(50);
    expect(isIdle).toBe(false);
    expect(queue.getPendingCount()).toBe(1);
  });

  it('stopAccepting rejects new enqueues while allowing queued jobs to drain', async () => {
    const queue = new JobQueue();
    const executed: string[] = [];

    let resolveJob: () => void = noop;
    const jobPromise = new Promise<void>((r) => {
      resolveJob = r;
    });

    const accepted1 = queue.enqueue('printer-1', async () => {
      await jobPromise;
      executed.push('job1');
    });
    expect(accepted1).toBe(true);

    // Stop accepting
    queue.stopAccepting();
    expect(queue.isAccepting()).toBe(false);

    // New enqueue is rejected
    const accepted2 = queue.enqueue('printer-1', async () => {
      executed.push('job2');
    });
    expect(accepted2).toBe(false);

    resolveJob();
    const isIdle = await queue.waitForIdle(1000);
    expect(isIdle).toBe(true);
    expect(executed).toEqual(['job1']);

    // Resume accepting
    queue.resumeAccepting();
    expect(queue.isAccepting()).toBe(true);
    const accepted3 = queue.enqueue('printer-1', async () => {
      executed.push('job3');
    });
    expect(accepted3).toBe(true);
  });
});
