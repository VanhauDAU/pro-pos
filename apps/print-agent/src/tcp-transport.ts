import { TcpEscPosTransport, type TcpTransportOptions } from '@printing/transports/tcp-transport';

export interface TcpPrintOptions {
  host: string;
  port?: number;
}

/** Compatibility adapter for the CLI/runtime API; TCP behaviour lives in the shared printing core. */
export class AgentTcpTransport {
  private readonly transport: TcpEscPosTransport;

  constructor(options?: TcpTransportOptions) {
    this.transport = new TcpEscPosTransport(options);
  }

  send(data: Uint8Array, options: TcpPrintOptions): Promise<void> {
    return this.transport.print(data, {
      connectionType: 'NETWORK_TCP',
      networkIp: options.host,
      networkPort: options.port ?? 9100,
      paperSize: 'K80',
      autoCut: false,
      openCashDrawer: false,
    });
  }
}
