export interface LoginItemApp {
  setLoginItemSettings(settings: { openAtLogin: boolean; args: string[] }): void;
  getLoginItemSettings(): { openAtLogin: boolean };
}

export class AutostartController {
  constructor(private readonly app: LoginItemApp) {}

  isEnabled(): boolean {
    return this.app.getLoginItemSettings().openAtLogin;
  }

  setEnabled(enabled: boolean): void {
    this.app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
  }
}
