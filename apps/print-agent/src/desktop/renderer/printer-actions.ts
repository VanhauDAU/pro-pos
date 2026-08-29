import type { ProPosPrintAgentApi } from '../shared/desktop-api';

export function requestPrinterCheck(api: Pick<ProPosPrintAgentApi, 'testPrinter'>) {
  return api.testPrinter();
}
