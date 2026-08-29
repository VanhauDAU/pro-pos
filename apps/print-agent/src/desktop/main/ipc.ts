import { mkdirSync } from 'node:fs';
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import type { AgentRuntime } from '../../core/agent-runtime';
import type {
  DesktopAgentConfig,
  DesktopPrintJobState,
  DesktopSettingsInput,
} from '../shared/desktop-api';
import type { AutostartController } from './autostart';
import type { DesktopConfigStore } from './config-store';

function normalizeConfig(
  runtime: AgentRuntime,
  configStore: DesktopConfigStore,
): DesktopAgentConfig {
  const config = runtime.getConfig() ?? configStore.loadConfig();
  return {
    serverUrl: config.serverUrl,
    storeId: config.storeId ?? null,
    storeName: config.storeName ?? null,
    agentId: config.agentId ?? null,
    printerIp: config.printerIp?.trim() || '',
    printerPort: config.printerPort || 9100,
    paperSize: config.paperSize || 'K80',
  };
}

function validateSettings(value: unknown): DesktopSettingsInput {
  if (!value || typeof value !== 'object') throw new Error('Cài đặt không hợp lệ.');
  const settings = value as Partial<DesktopSettingsInput>;
  const serverUrl = settings.serverUrl?.trim();
  const printerIp = settings.printerIp?.trim();
  const printerPort = Number(settings.printerPort);
  if (!serverUrl) throw new Error('Địa chỉ máy chủ không được để trống.');
  const url = new URL(serverUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Địa chỉ máy chủ phải bắt đầu bằng http:// hoặc https://.');
  }
  if (!printerIp || printerIp.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(printerIp)) {
    throw new Error('Địa chỉ IP hoặc tên máy in không hợp lệ.');
  }
  if (!Number.isInteger(printerPort) || printerPort < 1 || printerPort > 65_535) {
    throw new Error('Cổng máy in phải nằm trong khoảng 1–65535.');
  }
  if (settings.paperSize !== 'K58' && settings.paperSize !== 'K80') {
    throw new Error('Khổ giấy không hợp lệ.');
  }
  return {
    serverUrl: url.toString().replace(/\/$/, ''),
    printerIp,
    printerPort,
    paperSize: settings.paperSize,
  };
}

function relaunchAfterResponse(): void {
  setTimeout(() => {
    app.relaunch();
    app.quit();
  }, 250);
}

export function registerAgentIpc(
  runtime: AgentRuntime,
  getWindow: () => BrowserWindow | null,
  autostart: AutostartController,
  configStore: DesktopConfigStore,
): void {
  let lastJob: DesktopPrintJobState | null = null;
  const publishJob = (job: DesktopPrintJobState) => {
    lastJob = job;
    getWindow()?.webContents.send('agent:job-changed', job);
  };

  ipcMain.handle('agent:get-state', () => runtime.getState());
  ipcMain.handle('agent:get-info', () => ({
    version: app.getVersion(),
    autostart: autostart.isEnabled(),
    config: normalizeConfig(runtime, configStore),
  }));
  ipcMain.handle('agent:get-last-job', () => lastJob);
  ipcMain.handle('agent:test-printer', () => runtime.testPrinter());
  ipcMain.handle('agent:reconnect', () => runtime.reconnect());
  ipcMain.handle('agent:start-pairing', () => runtime.startPairing());
  ipcMain.handle('agent:cancel-pairing', () => runtime.cancelPairing());
  ipcMain.handle('agent:set-autostart', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Trạng thái tự khởi động không hợp lệ.');
    autostart.setEnabled(enabled);
    return autostart.isEnabled();
  });
  ipcMain.handle('agent:save-settings', async (_event, value: unknown) => {
    const settings = validateSettings(value);
    const current = runtime.getConfig() ?? configStore.loadConfig();
    const serverChanged = current.serverUrl.replace(/\/$/, '') !== settings.serverUrl;
    configStore.saveConfig({ ...current, ...settings });
    if (serverChanged && configStore.isPaired(current)) configStore.clearPairing();
    await runtime.stop();
    relaunchAfterResponse();
  });
  ipcMain.handle('agent:open-logs', async () => {
    const logsPath = app.getPath('logs');
    mkdirSync(logsPath, { recursive: true });
    const error = await shell.openPath(logsPath);
    if (error) throw new Error(error);
    return logsPath;
  });
  ipcMain.handle('agent:reset-pairing', async () => {
    await runtime.stop();
    configStore.clearPairing();
    relaunchAfterResponse();
  });
  ipcMain.handle('agent:reset-all', async () => {
    await runtime.stop();
    configStore.reset();
    relaunchAfterResponse();
  });
  ipcMain.handle('agent:show-window', () => getWindow()?.show());

  runtime.on('stateChanged', (state) => {
    getWindow()?.webContents.send('agent:state-changed', state);
  });
  runtime.on('jobReceived', ({ jobId, type }: { jobId: string; type: string }) => {
    publishJob({ jobId, documentType: type, status: 'SENDING', updatedAt: Date.now() });
  });
  runtime.on('jobStarted', ({ jobId }: { jobId: string }) => {
    publishJob({
      jobId,
      documentType: lastJob?.jobId === jobId ? lastJob.documentType : null,
      status: 'SENDING',
      updatedAt: Date.now(),
    });
  });
  runtime.on('jobCompleted', ({ jobId, sentAt }: { jobId: string; sentAt: number }) => {
    publishJob({
      jobId,
      documentType: lastJob?.jobId === jobId ? lastJob.documentType : null,
      status: 'COMPLETED',
      updatedAt: sentAt,
    });
  });
  runtime.on('jobFailed', ({ jobId, code }: { jobId: string; code: string }) => {
    publishJob({
      jobId,
      documentType: lastJob?.jobId === jobId ? lastJob.documentType : null,
      status: 'FAILED',
      updatedAt: Date.now(),
      failureCode: code,
    });
  });
}
