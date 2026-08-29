import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import type { AgentRuntime } from '../../core/agent-runtime';
import type { AutostartController } from './autostart';

export function createAgentTray(
  runtime: AgentRuntime,
  getWindow: () => BrowserWindow | null,
  autostart: AutostartController,
): Tray {
  const iconPath = join(__dirname, '../renderer/icon.png');
  const trayIcon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage
        .createFromDataURL(
          `data:image/svg+xml;base64,${Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0975f7"/><path d="M9 8h14v6h2a3 3 0 0 1 3 3v7h-5v4H9v-4H4v-7a3 3 0 0 1 3-3h2V8Zm3 3v5h8v-5h-8Zm0 10v4h8v-4h-8Zm12-4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" fill="white"/></svg>',
          ).toString('base64')}`,
        )
        .resize({ width: 16, height: 16 });
  const tray = new Tray(trayIcon);
  const statusLabel = () => {
    const state = runtime.getState();
    if (state.status === 'ONLINE' && state.printer === 'READY') return 'Máy in sẵn sàng';
    if (state.status === 'ONLINE') return 'Print Agent đang hoạt động';
    if (state.status === 'CONNECTING') return 'Print Agent đang kết nối';
    if (state.status === 'UNPAIRED' || state.status === 'PAIRING')
      return 'Print Agent chưa ghép nối';
    return 'Print Agent đang mất kết nối';
  };
  const refreshMenu = () => {
    tray.setToolTip(`PRO POS Print Agent · ${statusLabel()}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: statusLabel(), enabled: false },
        { type: 'separator' },
        { label: 'Mở Print Agent', click: () => getWindow()?.show() },
        { label: 'In thử', click: () => void runtime.testPrinter() },
        { label: 'Kết nối lại', click: () => void runtime.reconnect() },
        {
          label:
            process.platform === 'darwin'
              ? 'Khởi động cùng macOS'
              : process.platform === 'win32'
                ? 'Khởi động cùng Windows'
                : 'Khởi động cùng hệ thống',
          type: 'checkbox',
          checked: autostart.isEnabled(),
          click: (item) => autostart.setEnabled(item.checked),
        },
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
