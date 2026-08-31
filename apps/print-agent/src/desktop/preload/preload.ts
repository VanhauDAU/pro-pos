import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopSettingsInput, ProPosPrintAgentApi } from '../shared/desktop-api';

const api: ProPosPrintAgentApi = {
  getState: () => ipcRenderer.invoke('agent:get-state'),
  getInfo: () => ipcRenderer.invoke('agent:get-info'),
  getLastJob: () => ipcRenderer.invoke('agent:get-last-job'),
  testPrinter: (settings?: DesktopSettingsInput) =>
    ipcRenderer.invoke('agent:test-printer', settings),
  listPrinters: () => ipcRenderer.invoke('agent:list-printers'),
  reconnect: () => ipcRenderer.invoke('agent:reconnect'),
  startPairing: () => ipcRenderer.invoke('agent:start-pairing'),
  cancelPairing: () => ipcRenderer.invoke('agent:cancel-pairing'),
  setAutostart: (enabled) => ipcRenderer.invoke('agent:set-autostart', enabled),
  saveSettings: (settings) => ipcRenderer.invoke('agent:save-settings', settings),
  openLogs: () => ipcRenderer.invoke('agent:open-logs'),
  resetPairing: () => ipcRenderer.invoke('agent:reset-pairing'),
  resetAll: () => ipcRenderer.invoke('agent:reset-all'),
  showWindow: () => ipcRenderer.invoke('agent:show-window'),
  getUpdateState: () => ipcRenderer.invoke('agent:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('agent:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('agent:download-update'),
  installUpdate: () => ipcRenderer.invoke('agent:install-update'),
  onStateChanged: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on('agent:state-changed', callback);
    return () => ipcRenderer.removeListener('agent:state-changed', callback);
  },
  onJobChanged: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, job: Parameters<typeof listener>[0]) =>
      listener(job);
    ipcRenderer.on('agent:job-changed', callback);
    return () => ipcRenderer.removeListener('agent:job-changed', callback);
  },
  onUpdateStateChanged: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on('agent:update-state-changed', callback);
    return () => ipcRenderer.removeListener('agent:update-state-changed', callback);
  },
};

contextBridge.exposeInMainWorld('proposPrintAgent', api);
