import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createAgentWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 520,
    height: 620,
    minWidth: 420,
    minHeight: 500,
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
  window.once('ready-to-show', () => window.show());
  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
