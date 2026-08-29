import type { AgentRuntimeState, PrinterTestResult } from '../../core/agent-runtime';

export interface ProPosPrintAgentApi {
  getState(): Promise<AgentRuntimeState>;
  testPrinter(): Promise<PrinterTestResult>;
  reconnect(): Promise<void>;
  showWindow(): Promise<void>;
  onStateChanged(listener: (state: AgentRuntimeState) => void): () => void;
}

declare global {
  interface Window {
    proposPrintAgent: ProPosPrintAgentApi;
  }
}
