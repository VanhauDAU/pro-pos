import { EventEmitter } from 'node:events';
import { AgentApiClient } from '../api-client';
import { ConfigManager, type PrintAgentConfig } from '../config';
import { PairingHandler } from '../pairing';
import {
  AgentRealtimeClient,
  type AgentRealtimeEvents,
  type RealtimeConnection,
} from '../realtime-client';
import { CompositePrinterTransport } from '../transports/composite-transport';
import type {
  AgentPrinterConnection,
  AgentPrinterTransport,
} from '../transports/printer-transport';
import { buildEscPosTextReceipt } from '@printing/escpos/escpos-text-builder';
import type {
  AgentRuntimeEvent,
  AgentRuntimeState,
  AgentStatus,
  PairingState,
  PrinterStatus,
  PrinterTestResult,
} from './agent-state';
import { mapPrinterErrorDiagnostics } from './printer-diagnostics';
import { AgentPrintCache } from './print-cache';

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

export interface AgentRuntimeDependencies {
  configManager?: RuntimeConfigStore;
  createApiClient?: (config: PrintAgentConfig) => AgentApiClient;
  createRealtimeClient?: (
    config: PrintAgentConfig,
    apiClient: AgentApiClient,
    events: AgentRealtimeEvents,
    printCache: AgentPrintCache,
    transport?: AgentPrinterTransport,
  ) => RealtimeConnection;
  createPairingHandler?: (
    configManager: RuntimeConfigStore,
    config: PrintAgentConfig,
  ) => RuntimePairingHandler;
  createTransport?: () => AgentPrinterTransport;
}

/**
 * The only lifecycle owner for a Print Agent process. It deliberately has no
 * Electron imports so both the CLI and future desktop shell use the same
 * pairing, realtime, recovery, and shutdown path.
 */
export class AgentRuntime extends EventEmitter {
  private readonly configManager: RuntimeConfigStore;
  private readonly createApiClient: (config: PrintAgentConfig) => AgentApiClient;
  private readonly createRealtimeClient: NonNullable<
    AgentRuntimeDependencies['createRealtimeClient']
  >;
  private readonly createPairingHandler: NonNullable<
    AgentRuntimeDependencies['createPairingHandler']
  >;
  private readonly createTransport: NonNullable<AgentRuntimeDependencies['createTransport']>;
  private config: PrintAgentConfig | null;
  private printCache: AgentPrintCache | null = null;
  private realtime: RealtimeConnection | null = null;
  private pairingAbortController: AbortController | null = null;
  private readonly state: AgentRuntimeState = {
    status: 'STOPPED',
    printer: 'UNKNOWN',
    pairing: { code: null, expiresAt: null },
    lastError: null,
    printerDiagnostics: null,
    updatedAt: Date.now(),
  };

  constructor(initialConfig?: PrintAgentConfig, dependencies: AgentRuntimeDependencies = {}) {
    super();
    this.config = initialConfig ?? null;
    this.configManager = dependencies.configManager ?? new ConfigManager();
    this.createApiClient = dependencies.createApiClient ?? ((config) => new AgentApiClient(config));
    this.createRealtimeClient =
      dependencies.createRealtimeClient ??
      ((config, apiClient, events, printCache, transport) =>
        new AgentRealtimeClient(config, apiClient, events, printCache, transport));
    this.createPairingHandler =
      dependencies.createPairingHandler ??
      ((configManager, config) => new PairingHandler(configManager as ConfigManager, config));
    this.createTransport = dependencies.createTransport ?? (() => new CompositePrinterTransport());
  }

  getConfig(): PrintAgentConfig | null {
    return this.config ? { ...this.config } : null;
  }

  getState(): AgentRuntimeState {
    return {
      ...this.state,
      pairing: { ...this.state.pairing },
      printerDiagnostics: this.state.printerDiagnostics
        ? { ...this.state.printerDiagnostics }
        : null,
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

  getPendingPrintJobCount(): number {
    return this.realtime?.getPendingJobCount?.() ?? 0;
  }

  isPrintIdle(): boolean {
    return this.realtime?.isIdle?.() ?? true;
  }

  async stop(): Promise<void> {
    this.pairingAbortController?.abort();
    this.pairingAbortController = null;
    this.realtime?.destroy();
    this.realtime = null;
    this.printCache?.clear();
    this.updatePairing({ code: null, expiresAt: null });
    this.setStatus('STOPPED');
  }

  async stopGracefully(options: { timeoutMs?: number } = {}): Promise<'SUCCESS' | 'DRAIN_TIMEOUT'> {
    this.pairingAbortController?.abort();
    this.pairingAbortController = null;
    this.updatePairing({ code: null, expiresAt: null });

    if (!this.realtime) {
      this.printCache?.clear();
      this.setStatus('STOPPED');
      return 'SUCCESS';
    }

    if (typeof this.realtime.quiesceAndDrain === 'function') {
      const result = await this.realtime.quiesceAndDrain(options.timeoutMs ?? 30_000);
      if (result === 'DRAIN_TIMEOUT') {
        // Rollback: abort install and safely resume the realtime client
        this.realtime.resumeAfterDrainAbort?.();
        return 'DRAIN_TIMEOUT';
      }
    } else {
      this.realtime.destroy();
    }

    this.realtime = null;
    this.printCache?.clear();
    this.setStatus('STOPPED');
    return 'SUCCESS';
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
        if (this.pairingAbortController === pairingAbortController) this.setStatus('UNPAIRED');
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

  async testPrinter(overrideConfig?: Partial<PrintAgentConfig>): Promise<PrinterTestResult> {
    const config = overrideConfig ? { ...this.config, ...overrideConfig } : this.config;
    if (overrideConfig) {
      this.config = config as PrintAgentConfig;
    }
    const connectionType = config?.connectionType || 'NETWORK_TCP';
    const printerName = config?.printerName?.trim() || '';
    const host = config?.printerIp?.trim() || '';
    const port = config?.printerPort ?? 9100;

    let connection: AgentPrinterConnection;

    if (connectionType === 'WINDOWS_PRINTER') {
      if (!printerName) {
        const error = 'Tên máy in Windows không được để trống.';
        const diagnostics = {
          errorCode: 'INVALID_PRINTER_CONFIG',
          printerCode: 'INVALID_PRINTER_CONFIG',
          connectionType: 'WINDOWS_PRINTER' as const,
          printerName,
          failureStage: 'BEFORE_WRITE' as const,
        };
        this.setPrinterStatus('INVALID_CONFIG', error, diagnostics);
        return { ok: false, connectionType: 'WINDOWS_PRINTER', printerName, error, diagnostics };
      }
      connection = { type: 'WINDOWS_PRINTER', printerName };
    } else {
      if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
        const error = !host
          ? 'Địa chỉ IP máy in không hợp lệ.'
          : 'Cổng máy in phải nằm trong khoảng 1–65535.';
        const diagnostics = {
          errorCode: 'INVALID_PRINTER_CONFIG',
          printerCode: 'INVALID_PRINTER_CONFIG',
          connectionType: 'NETWORK_TCP' as const,
          host,
          port,
          failureStage: 'BEFORE_WRITE' as const,
        };
        this.setPrinterStatus('INVALID_CONFIG', error, diagnostics);
        return { ok: false, connectionType: 'NETWORK_TCP', host, port, error, diagnostics };
      }
      connection = { type: 'NETWORK_TCP', host, port };
    }

    const receipt = buildEscPosTextReceipt(
      {
        receiptType: 'PAYMENT',
        orderCode: 'TEST-001',
        invoiceCode: 'TEST-001',
        orderType: 'DINE_IN',
        total: 50000,
        subtotal: 50000,
        discountTotal: 0,
        issuedAtMs: Date.now(),
        tableName: 'Bàn Test',
        cashierName: 'Print Agent Test',
        lines: [
          {
            id: '1',
            name: 'In thử Pro POS Print Agent',
            quantity: 1,
            unitPrice: 50000,
            totalPrice: 50000,
          },
        ],
      },
      {
        paperSize: config?.paperSize || 'K80',
        storeName:
          connectionType === 'WINDOWS_PRINTER'
            ? `PRO POS TEST · ${printerName}`
            : 'PRO POS PRINT AGENT TEST',
        autoCut: true,
      },
    );

    try {
      await this.createTransport().send(receipt, connection);
      this.setPrinterStatus('READY');
      return {
        ok: true,
        connectionType,
        ...(connectionType === 'WINDOWS_PRINTER' ? { printerName } : { host, port }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostics = mapPrinterErrorDiagnostics(error, {
        connectionType,
        ...(connectionType === 'WINDOWS_PRINTER' ? { printerName } : { host, port }),
      });
      this.setPrinterStatus('UNREACHABLE', message, diagnostics);
      return {
        ok: false,
        connectionType,
        ...(connectionType === 'WINDOWS_PRINTER' ? { printerName } : { host, port }),
        error: message,
        diagnostics,
      };
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
      onPhase: (phase) => this.setStatus(phase),
      onConnected: () => this.setStatus('ONLINE'),
      onDisconnected: (error) => this.setStatus('OFFLINE', error),
      onDegraded: (error) => this.setStatus('DEGRADED', error),
      onJobReceived: (jobId, type) => this.emit('jobReceived', { jobId, type }),
      onJobStarted: (jobId) => this.emit('jobStarted', { jobId }),
      onJobCompleted: (jobId, sentAt) => this.emit('jobCompleted', { jobId, sentAt }),
      onJobFailed: (jobId, code, retryable) => this.emit('jobFailed', { jobId, code, retryable }),
    };
    const apiClient = this.createApiClient(config);
    this.printCache = new AgentPrintCache(apiClient);
    this.realtime = this.createRealtimeClient(config, apiClient, events, this.printCache);
    this.realtime.connect();
  }

  private setStatus(status: AgentStatus, lastError: string | null = null): void {
    this.state.status = status;
    this.state.lastError = lastError;
    this.state.updatedAt = Date.now();
    this.emit('stateChanged', this.getState());
  }

  private setPrinterStatus(
    status: PrinterStatus,
    lastError: string | null = null,
    printerDiagnostics: AgentRuntimeState['printerDiagnostics'] = null,
  ): void {
    this.state.printer = status;
    this.state.lastError = lastError;
    this.state.printerDiagnostics = printerDiagnostics;
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
