type JobTask = () => Promise<void>;

export class JobQueue {
  private readonly queues = new Map<string, JobTask[]>();
  private readonly running = new Set<string>();

  enqueue(printerKey: string, task: JobTask): void {
    const queue = this.queues.get(printerKey) || [];
    queue.push(task);
    this.queues.set(printerKey, queue);

    void this.processNext(printerKey);
  }

  private async processNext(printerKey: string): Promise<void> {
    if (this.running.has(printerKey)) {
      return;
    }

    const queue = this.queues.get(printerKey);
    if (!queue || queue.length === 0) {
      this.queues.delete(printerKey);
      return;
    }

    const nextTask = queue.shift();
    if (!nextTask) return;

    this.running.add(printerKey);
    try {
      await nextTask();
    } catch (err) {
      console.error(`[JobQueue] Task error on printer ${printerKey}:`, err);
    } finally {
      this.running.delete(printerKey);
      // Process remaining in queue
      void this.processNext(printerKey);
    }
  }

  getPendingCount(printerKey?: string): number {
    if (printerKey) {
      return (this.queues.get(printerKey)?.length ?? 0) + (this.running.has(printerKey) ? 1 : 0);
    }
    let total = 0;
    for (const q of this.queues.values()) {
      total += q.length;
    }
    total += this.running.size;
    return total;
  }
}
