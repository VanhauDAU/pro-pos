import { app, type BrowserWindow } from 'electron';
import { AgentRuntime } from '../../core/agent-runtime';
import { registerAgentIpc } from './ipc';
import { createAgentTray } from './tray';
import { createAgentWindow } from './window';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.propos.print-agent');
    const runtime = new AgentRuntime();
    await runtime.start();
    mainWindow = createAgentWindow();
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    registerAgentIpc(runtime, () => mainWindow);
    createAgentTray(runtime, () => mainWindow);

    app.on('before-quit', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        isQuitting = true;
        void runtime.stop().finally(() => app.quit());
      }
    });
    process.once('SIGTERM', () => app.quit());
  });
}
