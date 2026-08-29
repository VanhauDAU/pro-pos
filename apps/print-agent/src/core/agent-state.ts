export type AgentStatus =
  | 'UNPAIRED'
  | 'PAIRING'
  | 'CONNECTING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'STOPPED';

export type PrinterStatus = 'UNKNOWN' | 'READY' | 'UNREACHABLE' | 'INVALID_CONFIG';

export interface PairingState {
  code: string | null;
  expiresAt: number | null;
}

export interface AgentRuntimeState {
  status: AgentStatus;
  printer: PrinterStatus;
  pairing: PairingState;
  lastError: string | null;
  updatedAt: number;
}

export type AgentRuntimeEvent =
  | 'stateChanged'
  | 'pairingChanged'
  | 'printerStateChanged'
  | 'jobReceived'
  | 'jobStarted'
  | 'jobCompleted'
  | 'jobFailed';

export interface PrinterTestResult {
  ok: boolean;
  host: string;
  port: number;
  error?: string;
}
