import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import type { AgentRuntime } from '../../core/agent-runtime';

export function createAgentTray(runtime: AgentRuntime, getWindow: () => BrowserWindow | null): Tray {
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('PRO POS Print Agent');
  const refreshMenu = () => {
    const state = runtime.getState();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Trạng thái: ${state.status}`, enabled: false },
        { type: 'separator' },
        { label: 'Mở', click: () => getWindow()?.show() },
        { label: 'In thử', click: () => void runtime.testPrinter() },
        { label: 'Kết nối lại', click: () => void runtime.reconnect() },
        { type: 'separator' },
        { label: 'Thoát', click: () => process.emit('SIGTERM') },
      ]),
    );
  };
  tray.on('click', () => getWindow()?.show());
  runtime.on('stateChanged', refreshMenu);
  refreshMenu();
  return tray;
}
