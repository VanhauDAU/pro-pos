import { app, type BrowserWindow } from 'electron';
import { AgentRuntime } from '../../core/agent-runtime';
import { registerAgentIpc } from './ipc';
import { createAgentTray } from './tray';
import { createAgentWindow } from './window';
import { DesktopConfigStore } from './config-store';
import { AutostartController } from './autostart';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const startHidden = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.propos.print-agent');
    const runtime = new AgentRuntime(undefined, {
      configManager: new DesktopConfigStore(app.getPath('userData')),
    });
    await runtime.start();
    const autostart = new AutostartController(app);
    mainWindow = createAgentWindow(startHidden);
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    registerAgentIpc(runtime, () => mainWindow);
    createAgentTray(runtime, () => mainWindow, autostart);
    runtime.on('stateChanged', (state) => {
      if (state.status === 'ONLINE' && !autostart.isEnabled()) autostart.setEnabled(true);
    });

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
