import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AutostartController } from '../../apps/print-agent/src/desktop/main/autostart';

describe('AutostartController', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('starts hidden and passes target executable path and args', () => {
    const app = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    };
    const controller = new AutostartController(app, 'C:\\Programs\\propos-print-agent.exe');
    expect(controller.isEnabled()).toBe(false);

    controller.setEnabled(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
      path: 'C:\\Programs\\propos-print-agent.exe',
      args: ['--hidden'],
    });

    controller.setEnabled(false);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
      openAsHidden: false,
      path: 'C:\\Programs\\propos-print-agent.exe',
      args: [],
    });
  });

  it('correctly detects autostart on Windows when args are stored as --hidden', () => {
    const app = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn((opts?: { args?: string[] }) => {
        if (opts?.args?.includes('--hidden')) {
          return { openAtLogin: true, executableWillLaunchAtLogin: true };
        }
        // When queried without matching args on Windows, Electron returns openAtLogin: false
        return { openAtLogin: false, executableWillLaunchAtLogin: true };
      }),
    };
    const controller = new AutostartController(app);
    expect(controller.isEnabled()).toBe(true);
  });

  it('prioritizes PORTABLE_EXECUTABLE_FILE environment variable for portable Windows builds', () => {
    process.env.PORTABLE_EXECUTABLE_FILE = 'D:\\Tools\\PRO POS Print Agent-Portable.exe';
    const app = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: true })),
    };
    const controller = new AutostartController(app);

    controller.setEnabled(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
      path: 'D:\\Tools\\PRO POS Print Agent-Portable.exe',
      args: ['--hidden'],
    });
  });

  it('falls back gracefully if querying with path options throws', () => {
    const app = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn((opts?: unknown) => {
        if (opts && typeof opts === 'object') throw new Error('Unsupported options');
        return { openAtLogin: true };
      }),
    };
    const controller = new AutostartController(app);
    expect(controller.isEnabled()).toBe(true);
  });
});
