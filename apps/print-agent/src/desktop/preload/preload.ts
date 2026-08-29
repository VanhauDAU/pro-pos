import { contextBridge, ipcRenderer } from 'electron';
import type { ProPosPrintAgentApi } from '../shared/desktop-api';

const api: ProPosPrintAgentApi = {
  getState: () => ipcRenderer.invoke('agent:get-state'),
  testPrinter: () => ipcRenderer.invoke('agent:test-printer'),
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
  showWindow: () => ipcRenderer.invoke('agent:show-window'),
  onStateChanged: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on('agent:state-changed', callback);
    return () => ipcRenderer.removeListener('agent:state-changed', callback);
  },
};

contextBridge.exposeInMainWorld('proposPrintAgent', api);
