import WebSocket from 'ws';
import { AgentApiClient } from './api-client';
import type { PrintAgentConfig } from './config';
import { JobQueue } from './job-queue';
import { JobProcessor } from './job-processor';
import type { PrintJob } from '@contracts/print-job';
import { REALTIME_SUBPROTOCOL } from '@contracts/realtime';

export interface AgentRealtimeEvents {
  onConnected?(): void;
  onDisconnected?(error: string): void;
  onDegraded?(error: string): void;
  onJobReceived?(jobId: string, type: string): void;
  onJobStarted?(jobId: string): void;
  onJobCompleted?(jobId: string, sentAt: number): void;
  onJobFailed?(jobId: string, code: string, retryable: boolean): void;
}

export interface RealtimeConnection {
  connect(): void;
  destroy(): void;
}

export class AgentRealtimeClient implements RealtimeConnection {
  private ws: WebSocket | null = null;
  private isDestroyed = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollFallbackTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isRecovering = false;
  private readonly jobQueue = new JobQueue();
  private readonly processor: JobProcessor;
  private readonly processingJobs = new Set<string>();
  private readonly recentJobs = new Map<string, number>();
  private readonly recentJobTtlMs = 5 * 60_000;
  private readonly maxRecentJobs = 500;

  constructor(
    private readonly config: PrintAgentConfig,
    private readonly apiClient: AgentApiClient,
    private readonly events: AgentRealtimeEvents = {},
  ) {
    this.processor = new JobProcessor(config, apiClient);
  }

  connect(): void {
    if (this.isDestroyed || !this.config.agentId || !this.config.agentSecret) return;

    const baseWsUrl = this.config.serverUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');
    const wsUrl = `${baseWsUrl}/api/v1/pos/realtime/stream?agentId=${encodeURIComponent(this.config.agentId)}`;

    console.log(`[Realtime] Đang kết nối tới máy chủ (${this.config.serverUrl})...`);

    try {
      this.ws = new WebSocket(wsUrl, REALTIME_SUBPROTOCOL, {
        headers: {
          'X-Agent-Id': this.config.agentId,
          'X-Agent-Secret': this.config.agentSecret,
        },
      });

      this.ws.on('open', () => {
        console.log('\x1b[32m● [Realtime] Đã kết nối trực tuyến với máy chủ Pro POS!\x1b[0m');
        this.reconnectAttempt = 0;
        this.startHeartbeat();
        this.stopPollingFallback();
        this.events.onConnected?.();
        void this.recoverPendingJobs();
      });

      this.ws.on('message', (raw: WebSocket.Data) => {
        try {
          const payload = JSON.parse(raw.toString());
          this.handleMessage(payload);
        } catch {
          // ignore
        }
      });

      this.ws.on('close', (code, reason) => {
        this.stopHeartbeat();
        if (!this.isDestroyed) {
          const reasonStr = reason ? reason.toString() : '';
          console.warn(
            `[Realtime] Mất kết nối (code: ${code}${reasonStr ? `, lý do: ${reasonStr}` : ''}). Đang thử kết nối lại...`,
          );
          this.events.onDisconnected?.(reasonStr || `WebSocket closed (${code})`);
          this.startPollingFallback();
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Realtime] Lỗi kết nối WebSocket:', err.message);
        this.events.onDegraded?.(err.message);
      });
    } catch (err: any) {
      console.error('[Realtime] Lỗi khởi tạo WebSocket:', err?.message || err);
      this.scheduleReconnect();
    }
  }

  private handleMessage(message: any): void {
    if (message.type === 'ping') {
      this.ws?.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // Check for print_job event
    const eventName = message.name || message.type || message.event;
    if (eventName === 'pos.print_job.created' || eventName === 'print_job.created') {
      const job: PrintJob = message.payload || message.data;
      if (job && job.id) {
        console.log(`[Realtime] Nhận thông báo in: Job ID ${job.id}`);
        this.enqueueJob(job);
      }
    }
  }

  async recoverPendingJobs(): Promise<void> {
    if (this.isRecovering || this.isDestroyed) return;
    this.isRecovering = true;
    try {
      const jobs = await this.apiClient.get<PrintJob[]>(
        '/api/v1/pos/print-jobs?status=QUEUED&limit=20',
      );
      if (Array.isArray(jobs) && jobs.length > 0) {
        const printerKey = this.config.printerIp || 'default';
        for (const job of jobs) {
          this.enqueueJob(job, printerKey);
        }
      }
    } catch (err: any) {
      this.events.onDegraded?.(err?.message || String(err));
      if (err?.message?.includes('401') || err?.message?.includes('UNAUTHORIZED')) {
        console.error(
          '\n\x1b[31m✘ [PrintAgent] Xác thực thất bại với máy chủ (401 Unauthorized).\x1b[0m',
        );
        console.error(
          'Thông tin ghép nối trên máy này không khớp với máy chủ. Hãy chạy lại với cờ \x1b[1m--reset\x1b[0m để ghép nối lại mã mới:\n👉 pnpm dev -- --reset\n',
        );
      }
    } finally {
      this.isRecovering = false;
    }
  }

  private enqueueJob(job: PrintJob, printerKey = this.config.printerIp || 'default'): void {
    this.pruneRecentJobs();
    if (this.processingJobs.has(job.id) || this.recentJobs.has(job.id)) {
      console.info(`[Realtime] Bỏ qua print job trùng lặp: ${job.id}`);
      return;
    }
    this.processingJobs.add(job.id);
    this.events.onJobReceived?.(job.id, job.documentType);
    this.jobQueue.enqueue(printerKey, async () => {
      try {
        this.events.onJobStarted?.(job.id);
        const completed = await this.processor.processJob(job);
        if (completed) this.events.onJobCompleted?.(job.id, Date.now());
        else this.events.onJobFailed?.(job.id, 'PRINT_FAILED', false);
      } finally {
        this.processingJobs.delete(job.id);
        this.recentJobs.set(job.id, Date.now());
        this.pruneRecentJobs();
      }
    });
  }

  private pruneRecentJobs(): void {
    const cutoff = Date.now() - this.recentJobTtlMs;
    for (const [jobId, completedAt] of this.recentJobs) {
      if (completedAt < cutoff || this.recentJobs.size > this.maxRecentJobs) {
        this.recentJobs.delete(jobId);
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startPollingFallback(): void {
    if (this.pollFallbackTimer) return;
    // Periodic check every 3s as zero-latency safeguard for queued print jobs
    this.pollFallbackTimer = setInterval(() => {
      if (!this.isDestroyed) {
        void this.recoverPendingJobs();
      }
    }, 3000);
  }

  private stopPollingFallback(): void {
    if (this.pollFallbackTimer) {
      clearInterval(this.pollFallbackTimer);
      this.pollFallbackTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempt++;
    const baseDelay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), 10000);
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.stopHeartbeat();
    this.stopPollingFallback();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
