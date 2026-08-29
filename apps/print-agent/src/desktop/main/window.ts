import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createAgentWindow(startHidden = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 540,
    height: 700,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#f3f5f8',
    show: false,
    title: 'PRO POS Print Agent',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (!startHidden) window.once('ready-to-show', () => window.show());
  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
