import { EventEmitter } from 'node:events';
import { AgentApiClient } from '../api-client';
import { ConfigManager, type PrintAgentConfig } from '../config';
import { PairingHandler } from '../pairing';
import {
  AgentRealtimeClient,
  type AgentRealtimeEvents,
  type RealtimeConnection,
} from '../realtime-client';
import { AgentTcpTransport } from '../tcp-transport';
import { buildEscPosTextReceipt } from '@printing/escpos/escpos-text-builder';
import type {
  AgentRuntimeEvent,
  AgentRuntimeState,
  AgentStatus,
  PairingState,
  PrinterStatus,
  PrinterTestResult,
} from './agent-state';

export type { AgentRuntimeEvent, AgentRuntimeState, PrinterTestResult } from './agent-state';

interface RuntimeConfigStore {
  loadConfig(): PrintAgentConfig;
  saveConfig(config: PrintAgentConfig): void;
  isPaired(config: PrintAgentConfig): boolean;
}

interface RuntimePairingHandler {
  startPairingFlow(options?: {
    signal?: AbortSignal;
    onCodeReady?: (code: string, expiresAt: number) => void;
  }): Promise<PrintAgentConfig>;
}

interface RuntimeTransport {
  send(data: Uint8Array, options: { host: string; port?: number }): Promise<void>;
}

export interface AgentRuntimeDependencies {
  configManager?: RuntimeConfigStore;
  createApiClient?: (config: PrintAgentConfig) => AgentApiClient;
  createRealtimeClient?: (
    config: PrintAgentConfig,
    apiClient: AgentApiClient,
    events: AgentRealtimeEvents,
  ) => RealtimeConnection;
  createPairingHandler?: (
    configManager: RuntimeConfigStore,
    config: PrintAgentConfig,
  ) => RuntimePairingHandler;
  createTransport?: () => RuntimeTransport;
}

/**
 * The only lifecycle owner for a Print Agent process. It deliberately has no
 * Electron imports so both the CLI and future desktop shell use the same
 * pairing, realtime, recovery, and shutdown path.
 */
export class AgentRuntime extends EventEmitter {
  private readonly configManager: RuntimeConfigStore;
  private readonly createApiClient: (config: PrintAgentConfig) => AgentApiClient;
  private readonly createRealtimeClient: NonNullable<AgentRuntimeDependencies['createRealtimeClient']>;
  private readonly createPairingHandler: NonNullable<AgentRuntimeDependencies['createPairingHandler']>;
  private readonly createTransport: NonNullable<AgentRuntimeDependencies['createTransport']>;
  private config: PrintAgentConfig | null;
  private realtime: RealtimeConnection | null = null;
  private pairingAbortController: AbortController | null = null;
  private readonly state: AgentRuntimeState = {
    status: 'STOPPED',
    printer: 'UNKNOWN',
    pairing: { code: null, expiresAt: null },
    lastError: null,
    updatedAt: Date.now(),
  };

  constructor(initialConfig?: PrintAgentConfig, dependencies: AgentRuntimeDependencies = {}) {
    super();
    this.config = initialConfig ?? null;
    this.configManager = dependencies.configManager ?? new ConfigManager();
    this.createApiClient = dependencies.createApiClient ?? ((config) => new AgentApiClient(config));
    this.createRealtimeClient =
      dependencies.createRealtimeClient ??
      ((config, apiClient, events) => new AgentRealtimeClient(config, apiClient, events));
    this.createPairingHandler =
      dependencies.createPairingHandler ??
      ((configManager, config) => new PairingHandler(configManager as ConfigManager, config));
    this.createTransport = dependencies.createTransport ?? (() => new AgentTcpTransport());
  }

  getConfig(): PrintAgentConfig | null {
    return this.config ? { ...this.config } : null;
  }

  getState(): AgentRuntimeState {
    return {
      ...this.state,
      pairing: { ...this.state.pairing },
    };
  }

  on(event: AgentRuntimeEvent, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  async start(): Promise<void> {
    if (this.state.status !== 'STOPPED') return;
    this.config ??= this.configManager.loadConfig();
    if (!this.configManager.isPaired(this.config)) {
      this.setStatus('UNPAIRED');
      return;
    }
    this.connectRealtime();
  }

  async stop(): Promise<void> {
    this.pairingAbortController?.abort();
    this.pairingAbortController = null;
    this.realtime?.destroy();
    this.realtime = null;
    this.updatePairing({ code: null, expiresAt: null });
    this.setStatus('STOPPED');
  }

  async startPairing(): Promise<void> {
    if (!this.config) this.config = this.configManager.loadConfig();
    if (this.configManager.isPaired(this.config)) {
      this.connectRealtime();
      return;
    }
    this.cancelPairing();
    const pairingAbortController = new AbortController();
    this.pairingAbortController = pairingAbortController;
    this.setStatus('PAIRING');
    try {
      const handler = this.createPairingHandler(this.configManager, this.config);
      const pairedConfig = await handler.startPairingFlow({
        signal: pairingAbortController.signal,
        onCodeReady: (code, expiresAt) => this.updatePairing({ code, expiresAt }),
      });
      if (pairingAbortController.signal.aborted) return;
      this.config = pairedConfig;
      this.updatePairing({ code: null, expiresAt: null });
      this.connectRealtime();
    } catch (error) {
      if (pairingAbortController.signal.aborted) {
        this.setStatus('UNPAIRED');
        return;
      }
      this.setStatus('UNPAIRED', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (this.pairingAbortController === pairingAbortController) {
        this.pairingAbortController = null;
      }
    }
  }

  cancelPairing(): void {
    this.pairingAbortController?.abort();
    this.pairingAbortController = null;
    if (this.state.status === 'PAIRING') this.setStatus('UNPAIRED');
    this.updatePairing({ code: null, expiresAt: null });
  }

  async reconnect(): Promise<void> {
    if (!this.config || !this.configManager.isPaired(this.config)) {
      this.setStatus('UNPAIRED');
      return;
    }
    this.realtime?.destroy();
    this.realtime = null;
    this.connectRealtime();
  }

  async testPrinter(): Promise<PrinterTestResult> {
    const config = this.config;
    const host = config?.printerIp?.trim() || '192.168.1.73';
    const port = config?.printerPort || 9100;
    if (!host) {
      this.setPrinterStatus('INVALID_CONFIG', 'Địa chỉ IP máy in không hợp lệ.');
      return { ok: false, host, port, error: 'Địa chỉ IP máy in không hợp lệ.' };
    }
    const receipt = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT', orderCode: 'TEST-001', invoiceCode: 'TEST-001', orderType: 'DINE_IN',
        total: 50000, subtotal: 50000, discountTotal: 0, issuedAtMs: Date.now(),
        tableName: 'Bàn Test', cashierName: 'Print Agent Test',
        lines: [{ id: '1', name: 'In thử Pro POS Print Agent', quantity: 1, unitPrice: 50000, totalPrice: 50000 }],
      },
      { paperSize: config?.paperSize || 'K80', storeName: 'PRO POS PRINT AGENT TEST', autoCut: true },
    );
    try {
      await this.createTransport().send(receipt, { host, port });
      this.setPrinterStatus('READY');
      return { ok: true, host, port };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPrinterStatus('UNREACHABLE', message);
      return { ok: false, host, port, error: message };
    }
  }

  private connectRealtime(): void {
    const config = this.config;
    if (!config || !this.configManager.isPaired(config)) {
      this.setStatus('UNPAIRED');
      return;
    }
    this.realtime?.destroy();
    this.setStatus('CONNECTING');
    const events: AgentRealtimeEvents = {
      onConnected: () => this.setStatus('ONLINE'),
      onDisconnected: (error) => this.setStatus('OFFLINE', error),
      onDegraded: (error) => this.setStatus('DEGRADED', error),
      onJobReceived: (jobId, type) => this.emit('jobReceived', { jobId, type }),
      onJobStarted: (jobId) => this.emit('jobStarted', { jobId }),
      onJobCompleted: (jobId, sentAt) => this.emit('jobCompleted', { jobId, sentAt }),
      onJobFailed: (jobId, code, retryable) => this.emit('jobFailed', { jobId, code, retryable }),
    };
    this.realtime = this.createRealtimeClient(config, this.createApiClient(config), events);
    this.realtime.connect();
  }

  private setStatus(status: AgentStatus, lastError: string | null = null): void {
    this.state.status = status;
    this.state.lastError = lastError;
    this.state.updatedAt = Date.now();
    this.emit('stateChanged', this.getState());
  }

  private setPrinterStatus(status: PrinterStatus, lastError: string | null = null): void {
    this.state.printer = status;
    this.state.lastError = lastError;
    this.state.updatedAt = Date.now();
    this.emit('printerStateChanged', { status, error: lastError });
    this.emit('stateChanged', this.getState());
  }

  private updatePairing(pairing: PairingState): void {
    if (
      this.state.pairing.code === pairing.code &&
      this.state.pairing.expiresAt === pairing.expiresAt
    ) {
      return;
    }
    this.state.pairing = pairing;
    this.state.updatedAt = Date.now();
    this.emit('pairingChanged', pairing);
    this.emit('stateChanged', this.getState());
  }
}
