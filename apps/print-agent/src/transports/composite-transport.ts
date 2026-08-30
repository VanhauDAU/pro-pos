import { AgentTcpTransport } from '../tcp-transport';
import { WindowsRawPrinterTransport } from './windows-spooler-transport';
import type { AgentPrinterConnection, AgentPrinterTransport } from './printer-transport';

export class CompositePrinterTransport implements AgentPrinterTransport {
  constructor(
    private readonly tcpTransport: AgentPrinterTransport = new AgentTcpTransport(),
    private readonly windowsTransport: AgentPrinterTransport = new WindowsRawPrinterTransport(),
  ) {}

  async send(data: Uint8Array, connection: AgentPrinterConnection): Promise<void> {
    if (connection.type === 'WINDOWS_PRINTER') {
      return this.windowsTransport.send(data, connection);
    }
    return this.tcpTransport.send(data, connection);
  }
}
