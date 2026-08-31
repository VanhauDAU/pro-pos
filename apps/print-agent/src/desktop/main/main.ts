import { app, type BrowserWindow } from 'electron';
import { AgentRuntime } from '../../core/agent-runtime';
import { registerAgentIpc } from './ipc';
import { createAgentTray } from './tray';
import { createAgentWindow } from './window';
import { DesktopConfigStore } from './config-store';
import { AutostartController } from './autostart';
import { ShutdownCoordinator } from './shutdown-coordinator';
import { UpdateManager } from './update-manager';

let mainWindow: BrowserWindow | null = null;
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
    app.setAppLogsPath();
    const configStore = new DesktopConfigStore(app.getPath('userData'));
    const runtime = new AgentRuntime(undefined, {
      configManager: configStore,
    });
    await runtime.start();

    const shutdownCoordinator = new ShutdownCoordinator(runtime, () => app.quit());
    const updateManager = new UpdateManager({ shutdownCoordinator });
    updateManager.start();

    const autostart = new AutostartController(app);
    mainWindow = createAgentWindow(startHidden);
    mainWindow.on('close', (event) => {
      if (!shutdownCoordinator.isPermittedToQuit()) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });

    registerAgentIpc(runtime, () => mainWindow, autostart, configStore, updateManager);
    createAgentTray(runtime, () => mainWindow, autostart, updateManager);

    app.on('before-quit', (event) => {
      if (!shutdownCoordinator.isPermittedToQuit()) {
        event.preventDefault();
        void shutdownCoordinator.requestQuit('NORMAL');
      }
    });

    process.once('SIGTERM', () => {
      void shutdownCoordinator.requestQuit('SYSTEM');
    });
  });
}
