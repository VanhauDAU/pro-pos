import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export class AutostartManager {
  private readonly platform = process.platform;

  isSupported(): boolean {
    return this.platform === 'darwin' || this.platform === 'win32';
  }

  enable(): boolean {
    if (this.platform === 'darwin') {
      return this.enableMacLaunchAgent();
    }
    return false;
  }

  disable(): boolean {
    if (this.platform === 'darwin') {
      return this.disableMacLaunchAgent();
    }
    return false;
  }

  private enableMacLaunchAgent(): boolean {
    try {
      const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
      if (!fs.existsSync(plistDir)) {
        fs.mkdirSync(plistDir, { recursive: true });
      }
      const plistPath = path.join(plistDir, 'com.propos.printagent.plist');
      const nodePath = process.execPath;
      const scriptPath = process.argv[1];

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.propos.printagent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), '.propos-print-agent', 'output.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.propos-print-agent', 'error.log')}</string>
</dict>
</plist>`;

      fs.writeFileSync(plistPath, plistContent, 'utf8');
      return true;
    } catch (err) {
      console.error('[Autostart] Failed to register macOS LaunchAgent:', err);
      return false;
    }
  }

  private disableMacLaunchAgent(): boolean {
    try {
      const plistPath = path.join(
        os.homedir(),
        'Library',
        'LaunchAgents',
        'com.propos.printagent.plist',
      );
      if (fs.existsSync(plistPath)) {
        fs.unlinkSync(plistPath);
      }
      return true;
    } catch {
      return false;
    }
  }
}
