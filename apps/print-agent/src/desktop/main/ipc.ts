import { ipcMain, type BrowserWindow } from 'electron';
import type { AgentRuntime } from '../../core/agent-runtime';

export function registerAgentIpc(runtime: AgentRuntime, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('agent:get-state', () => runtime.getState());
  ipcMain.handle('agent:test-printer', () => runtime.testPrinter());
  ipcMain.handle('agent:reconnect', () => runtime.reconnect());
  ipcMain.handle('agent:show-window', () => getWindow()?.show());

  runtime.on('stateChanged', (state) => {
    getWindow()?.webContents.send('agent:state-changed', state);
  });
}
