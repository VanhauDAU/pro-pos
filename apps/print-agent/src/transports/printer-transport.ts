export type AgentPrinterConnection =
  | {
      type: 'NETWORK_TCP';
      host: string;
      port?: number;
    }
  | {
      type: 'WINDOWS_PRINTER';
      printerName: string;
    };

export interface AgentPrinterTransport {
  send(data: Uint8Array, connection: AgentPrinterConnection): Promise<void>;
}
