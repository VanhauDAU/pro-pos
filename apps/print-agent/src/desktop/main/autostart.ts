export interface LoginItemSettingsOptions {
  path?: string;
  args?: string[];
}

export interface LoginItemSettingsResult {
  openAtLogin: boolean;
  openAsHidden?: boolean;
  wasOpenedAtLogin?: boolean;
  wasOpenedAsHidden?: boolean;
  restoreState?: boolean;
  executableWillLaunchAtLogin?: boolean;
}

export interface LoginItemApp {
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    path?: string;
    args?: string[];
  }): void;
  getLoginItemSettings(options?: LoginItemSettingsOptions): LoginItemSettingsResult;
}

export class AutostartController {
  constructor(
    private readonly app: LoginItemApp,
    private readonly targetPath?: string,
  ) {}

  private getExecutablePath(): string {
    return this.targetPath || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  }

  isEnabled(): boolean {
    const execPath = this.getExecutablePath();
    const isWindows = process.platform === 'win32';

    try {
      if (isWindows) {
        // On Windows, Electron getLoginItemSettings requires matching args, otherwise openAtLogin returns false
        const hiddenSettings = this.app.getLoginItemSettings({
          path: execPath,
          args: ['--hidden'],
        });
        if (hiddenSettings.openAtLogin || hiddenSettings.executableWillLaunchAtLogin) {
          return true;
        }

        const defaultSettings = this.app.getLoginItemSettings({
          path: execPath,
          args: [],
        });
        if (defaultSettings.openAtLogin || defaultSettings.executableWillLaunchAtLogin) {
          return true;
        }
      }

      const settings = this.app.getLoginItemSettings({ path: execPath });
      if (settings.openAtLogin || settings.executableWillLaunchAtLogin) {
        return true;
      }
    } catch {
      // Ignore errors when querying with options
    }

    try {
      const fallback = this.app.getLoginItemSettings();
      return Boolean(fallback.openAtLogin || fallback.executableWillLaunchAtLogin);
    } catch {
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    const execPath = this.getExecutablePath();

    this.app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: enabled,
      path: execPath,
      args: enabled ? ['--hidden'] : [],
    });
  }
}
