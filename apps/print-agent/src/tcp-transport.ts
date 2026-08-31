import { TcpEscPosTransport, type TcpTransportOptions } from '@printing/transports/tcp-transport';
import type { AgentPrinterConnection, AgentPrinterTransport } from './transports/printer-transport';

export interface TcpPrintOptions {
  host: string;
  port?: number;
}

/** Compatibility adapter for the CLI/runtime API; TCP behaviour lives in the shared printing core. */
export class AgentTcpTransport implements AgentPrinterTransport {
  private readonly transport: TcpEscPosTransport;

  constructor(options?: TcpTransportOptions) {
    this.transport = new TcpEscPosTransport(options);
  }

  send(data: Uint8Array, options: AgentPrinterConnection | TcpPrintOptions): Promise<void> {
    const host = 'host' in options ? options.host : '';
    const port = 'port' in options ? (options.port ?? 9100) : 9100;

    return this.transport.print(data, {
      connectionType: 'NETWORK_TCP',
      networkIp: host,
      networkPort: port,
      paperSize: 'K80',
      autoCut: false,
      openCashDrawer: false,
    });
  }
}
