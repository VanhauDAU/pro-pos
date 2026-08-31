import { app, BrowserWindow, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function createAgentWindow(startHidden = false): BrowserWindow {
  const iconPath = join(__dirname, '../renderer/icon.png');
  const hasIcon = existsSync(iconPath);
  const window = new BrowserWindow({
    width: 720,
    height: 490,
    minWidth: 640,
    minHeight: 440,
    resizable: true,
    backgroundColor: '#f3f5f8',
    show: false,
    title: 'PRO POS Print Agent',
    ...(hasIcon ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (process.platform === 'darwin' && app.dock && existsSync(iconPath)) {
    try {
      const dockIcon = nativeImage.createFromPath(iconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    } catch {
      // ignore dock icon failure in unsupported environments
    }
  }

  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (!startHidden) window.once('ready-to-show', () => window.show());
  void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
