import WebSocket from 'ws';
import { AgentApiClient, AgentApiError } from './api-client';
import type { PrintAgentConfig } from './config';
import { JobQueue } from './job-queue';
import { JobProcessor } from './job-processor';
import type { PendingPrintJobPage, PrintJob } from '@contracts/print-job';
import { AgentPrintCache } from './core/print-cache';
import {
  REALTIME_SCHEMA_VERSION,
  REALTIME_SUBPROTOCOL,
  type RealtimeEventV1,
  type RealtimeServerFrame,
} from '@contracts/realtime';

export interface AgentRealtimeEvents {
  onConnected?(): void;
  onPhase?(phase: 'AUTHENTICATING' | 'REGISTERED' | 'SUBSCRIBED' | 'SYNCING'): void;
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
  private lastSeenTimer: NodeJS.Timeout | null = null;
  private pollFallbackTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private recoveryPromise: Promise<boolean> | null = null;
  private heartbeatPromise: Promise<unknown> | null = null;
  private isReady = false;
  private handshakeAcknowledged = false;
  private offlinePollAttempt = 0;
  private supportsPendingFeed = true;
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
    private readonly printCache: AgentPrintCache = new AgentPrintCache(apiClient),
  ) {
    this.processor = new JobProcessor(config, apiClient, undefined, printCache);
  }

  connect(): void {
    if (this.isDestroyed || !this.config.agentId || !this.config.agentSecret) return;

    const baseWsUrl = this.config.serverUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');
    const wsUrl = `${baseWsUrl}/api/v1/pos/realtime/stream?agentId=${encodeURIComponent(this.config.agentId)}`;

    console.log(`[Realtime] Đang kết nối tới máy chủ (${this.config.serverUrl})...`);
    this.events.onPhase?.('AUTHENTICATING');

    try {
      this.ws = new WebSocket(wsUrl, REALTIME_SUBPROTOCOL, {
        headers: {
          'X-Agent-Id': this.config.agentId,
          'X-Agent-Secret': this.config.agentSecret,
        },
      });

      this.ws.on('open', () => {
        console.log(
          '[PRINT-AGENT] Cloud transport connected; awaiting authentication/subscription ACK.',
        );
        this.reconnectAttempt = 0;
      });

      this.ws.on('message', (raw: WebSocket.Data) => {
        try {
          const payload = JSON.parse(raw.toString()) as RealtimeServerFrame | { type: 'pong' };
          this.handleMessage(payload);
        } catch {
          // ignore
        }
      });

      this.ws.on('close', (code, reason) => {
        this.stopHeartbeat();
        this.stopPollingFallback();
        this.isReady = false;
        this.handshakeAcknowledged = false;
        if (!this.isDestroyed) {
          const reasonStr = reason ? reason.toString() : '';
          console.warn(
            `[Realtime] Mất kết nối (code: ${code}${reasonStr ? `, lý do: ${reasonStr}` : ''}). Đang thử kết nối lại...`,
          );
          this.events.onDisconnected?.(reasonStr || `WebSocket closed (${code})`);
          this.startPollingFallback(true);
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Realtime] Lỗi kết nối WebSocket:', err.message);
        this.events.onDegraded?.(err.message);
      });
    } catch (err: any) {
      console.error('[Realtime] Lỗi khởi tạo WebSocket:', err?.message || err);
      this.startPollingFallback(true);
      this.scheduleReconnect();
    }
  }

  private handleMessage(message: RealtimeServerFrame | { type: 'pong' } | { type: 'ping' }): void {
    if (message.type === 'ping') {
      this.ws?.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    if (message.type === 'ready') {
      void this.completeHandshake(message);
      return;
    }
    if (message.type === 'events') void this.receiveEvents(message.events);
    if (message.type === 'error') this.events.onDegraded?.(`${message.code}: ${message.message}`);
  }

  private async completeHandshake(frame: Extract<RealtimeServerFrame, { type: 'ready' }>) {
    if (this.isReady || this.isDestroyed) return;
    if (frame.schemaVersion !== REALTIME_SCHEMA_VERSION) {
      this.events.onDegraded?.('SUBSCRIBE_FAILED: Realtime schema mismatch.');
      this.ws?.close(4406, 'Realtime schema mismatch');
      return;
    }
    console.log('[PRINT-AGENT] Subscription acknowledged; syncing pending print jobs.');
    this.handshakeAcknowledged = true;
    this.events.onPhase?.('REGISTERED');
    this.events.onPhase?.('SUBSCRIBED');
    this.events.onPhase?.('SYNCING');
    if (frame.sync?.mode === 'REPLAY') await this.receiveEvents(frame.sync.events);
    const [, synced] = await Promise.all([this.printCache.prewarm(), this.recoverPendingJobs()]);
    if (!synced || this.isDestroyed) {
      this.startPollingFallback();
      return;
    }
    this.markReady();
  }

  private markReady(): void {
    if (this.isReady || this.isDestroyed || !this.handshakeAcknowledged) return;
    this.isReady = true;
    this.offlinePollAttempt = 0;
    this.startHeartbeat();
    this.startPollingFallback();
    console.log('[PRINT-AGENT] Sync complete; print delivery is ready.');
    this.events.onConnected?.();
  }

  private async receiveEvents(events: RealtimeEventV1[]): Promise<void> {
    let needsPendingScan = false;
    for (const event of events) {
      if (event.type === 'pos.print_config.updated') {
        this.printCache.invalidate(event.data.configVersion ?? event.aggregate.version);
        continue;
      }
      if (event.type !== 'pos.print_job.created' || event.data.printJobStatus !== 'QUEUED')
        continue;
      if (event.data.targetDeviceId && event.data.targetDeviceId !== this.config.agentId) continue;
      const job = event.data.printJob;
      if (!job) {
        // Compatibility with servers that predate embedded print-job snapshots.
        // Scan the canonical pending collection; never add a detail GET back to
        // the realtime hot path.
        needsPendingScan = true;
        continue;
      }
      if (job.status !== 'QUEUED') continue;
      if (job.targetDeviceId && job.targetDeviceId !== this.config.agentId) continue;
      console.log(`[PRINT-AGENT] Job received id=${job.id}`);
      this.enqueueJob(job);
    }
    if (needsPendingScan) await this.recoverPendingJobs();
  }

  async recoverPendingJobs(): Promise<boolean> {
    if (this.isDestroyed) return false;
    if (this.recoveryPromise) return this.recoveryPromise;
    this.recoveryPromise = this.performPendingRecovery().finally(() => {
      this.recoveryPromise = null;
    });
    return this.recoveryPromise;
  }

  private async performPendingRecovery(): Promise<boolean> {
    try {
      const jobs: PrintJob[] = [];
      if (this.supportsPendingFeed) {
        let cursor: string | null = null;
        do {
          const query = cursor
            ? `/api/v1/pos/print-jobs/pending?limit=50&cursor=${encodeURIComponent(cursor)}`
            : '/api/v1/pos/print-jobs/pending?limit=50';
          let page: PendingPrintJobPage;
          try {
            page = await this.apiClient.get<PendingPrintJobPage>(query);
          } catch (error) {
            const isMissing =
              (error instanceof AgentApiError && error.status === 404) ||
              (error instanceof Error && /failed \(404\)/.test(error.message));
            if (!isMissing) throw error;
            this.supportsPendingFeed = false;
            break;
          }
          if (!page || !Array.isArray(page.jobs))
            throw new Error('Pending print feed không hợp lệ.');
          jobs.push(...page.jobs);
          cursor = page.nextCursor;
        } while (cursor && jobs.length < 1_000);
      }
      if (!this.supportsPendingFeed) {
        const legacyJobs = await this.apiClient.get<PrintJob[]>(
          '/api/v1/pos/print-jobs?status=QUEUED&limit=20',
        );
        jobs.push(
          ...legacyJobs.filter(
            (job) => !job.targetDeviceId || job.targetDeviceId === this.config.agentId,
          ),
        );
      }
      console.log(`[PRINT-AGENT] Sync pending jobs found=${jobs.length}`);
      if (jobs.length > 0) {
        for (const job of jobs) {
          this.enqueueJob(job);
        }
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.onDegraded?.(message);
      if (message.includes('401') || message.includes('UNAUTHORIZED')) {
        console.error(
          '\n\x1b[31m✘ [PrintAgent] Xác thực thất bại với máy chủ (401 Unauthorized).\x1b[0m',
        );
        console.error(
          'Thông tin ghép nối trên máy này không khớp với máy chủ. Hãy chạy lại với cờ \x1b[1m--reset\x1b[0m để ghép nối lại mã mới:\n👉 pnpm dev -- --reset\n',
        );
      }
      return false;
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
    void this.touchLastSeen();
    this.lastSeenTimer = setInterval(() => void this.touchLastSeen(), 45_000);
  }

  private touchLastSeen(): Promise<unknown> {
    if (this.heartbeatPromise) return this.heartbeatPromise;
    this.heartbeatPromise = this.apiClient
      .post('/api/v1/print-agent/heartbeat', {})
      .catch((error) => {
        this.events.onDegraded?.(
          `HEARTBEAT_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this.heartbeatPromise = null;
      });
    return this.heartbeatPromise;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.lastSeenTimer) {
      clearInterval(this.lastSeenTimer);
      this.lastSeenTimer = null;
    }
  }

  private startPollingFallback(immediate = false): void {
    if (this.pollFallbackTimer) return;
    this.schedulePendingScan(immediate ? 0 : this.nextPollDelay());
  }

  private nextPollDelay(): number {
    if (this.isReady) return 30_000;
    const base = Math.min(2_000 * 2 ** this.offlinePollAttempt, 30_000);
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  private schedulePendingScan(delayMs: number): void {
    this.pollFallbackTimer = setTimeout(async () => {
      this.pollFallbackTimer = null;
      if (this.isDestroyed) return;
      const synced = await this.recoverPendingJobs();
      if (!this.isReady) {
        if (synced && this.ws?.readyState === WebSocket.OPEN && this.handshakeAcknowledged) {
          this.markReady();
          return;
        }
        this.offlinePollAttempt = Math.min(this.offlinePollAttempt + 1, 4);
      } else {
        this.offlinePollAttempt = 0;
      }
      this.schedulePendingScan(this.nextPollDelay());
    }, delayMs);
  }

  private stopPollingFallback(): void {
    if (this.pollFallbackTimer) {
      clearTimeout(this.pollFallbackTimer);
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
        this.isReady = false;
        this.connect();
      }
    }, delay);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.stopHeartbeat();
    this.stopPollingFallback();
    this.isReady = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
