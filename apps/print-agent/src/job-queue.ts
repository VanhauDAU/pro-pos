import { EventEmitter } from 'node:events';

type JobTask = () => Promise<void>;

export class JobQueue {
  private readonly queues = new Map<string, JobTask[]>();
  private readonly running = new Set<string>();
  private isClosed = false;
  private readonly idleEmitter = new EventEmitter();

  enqueue(printerKey: string, task: JobTask): boolean {
    if (this.isClosed) {
      return false;
    }

    const queue = this.queues.get(printerKey) || [];
    queue.push(task);
    this.queues.set(printerKey, queue);

    void this.processNext(printerKey);
    return true;
  }

  stopAccepting(): void {
    this.isClosed = true;
  }

  resumeAccepting(): void {
    this.isClosed = false;
  }

  isAccepting(): boolean {
    return !this.isClosed;
  }

  isIdle(printerKey?: string): boolean {
    return this.getPendingCount(printerKey) === 0;
  }

  async waitForIdle(timeoutMs = 30_000): Promise<boolean> {
    if (this.isIdle()) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | null = null;

      const onIdle = () => {
        if (timer) clearTimeout(timer);
        this.idleEmitter.removeListener('idle', onIdle);
        resolve(true);
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.idleEmitter.removeListener('idle', onIdle);
          resolve(this.isIdle());
        }, timeoutMs);
      }

      this.idleEmitter.on('idle', onIdle);

      // Check again in case queue completed between initial check and listener attachment
      if (this.isIdle()) {
        onIdle();
      }
    });
  }

  private async processNext(printerKey: string): Promise<void> {
    if (this.running.has(printerKey)) {
      return;
    }

    const queue = this.queues.get(printerKey);
    if (!queue || queue.length === 0) {
      this.queues.delete(printerKey);
      this.checkAndNotifyIdle();
      return;
    }

    const nextTask = queue.shift();
    if (!nextTask) {
      this.checkAndNotifyIdle();
      return;
    }

    this.running.add(printerKey);
    try {
      await nextTask();
    } catch (err) {
      console.error(`[JobQueue] Task error on printer ${printerKey}:`, err);
    } finally {
      this.running.delete(printerKey);
      // Process remaining in queue
      void this.processNext(printerKey);
      this.checkAndNotifyIdle();
    }
  }

  private checkAndNotifyIdle(): void {
    if (this.isIdle()) {
      this.idleEmitter.emit('idle');
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
