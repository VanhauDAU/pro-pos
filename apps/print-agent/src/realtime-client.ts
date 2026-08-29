import WebSocket from 'ws';
import { AgentApiClient } from './api-client';
import type { PrintAgentConfig } from './config';
import { JobQueue } from './job-queue';
import { JobProcessor } from './job-processor';
import type { PrintJob } from '@contracts/print-job';
import { REALTIME_SUBPROTOCOL } from '@contracts/realtime';

export class AgentRealtimeClient {
  private ws: WebSocket | null = null;
  private isDestroyed = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollFallbackTimer: NodeJS.Timeout | null = null;
  private isRecovering = false;
  private readonly jobQueue = new JobQueue();
  private readonly processor: JobProcessor;

  constructor(
    private readonly config: PrintAgentConfig,
    private readonly apiClient: AgentApiClient,
  ) {
    this.processor = new JobProcessor(config, apiClient);
  }

  connect(): void {
    if (this.isDestroyed || !this.config.agentId || !this.config.agentSecret) return;

    this.startPollingFallback();

    const baseWsUrl = this.config.serverUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');
    const wsUrl = `${baseWsUrl}/api/v1/pos/realtime/stream?agentId=${encodeURIComponent(
      this.config.agentId,
    )}&agentSecret=${encodeURIComponent(this.config.agentSecret)}`;

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

      this.ws.on('close', (_code, _reason) => {
        this.stopHeartbeat();
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (_err) => {
        // Handled via reconnect & polling fallback
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
        const printerKey = this.config.printerIp || 'default';
        this.jobQueue.enqueue(printerKey, async () => {
          await this.processor.processJob(job);
        });
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
          this.jobQueue.enqueue(printerKey, async () => {
            await this.processor.processJob(job);
          });
        }
      }
    } catch {
      // ignore
    } finally {
      this.isRecovering = false;
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
    this.reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), 10000);
    setTimeout(() => {
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.stopHeartbeat();
    this.stopPollingFallback();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
