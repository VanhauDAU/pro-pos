import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UpdateManager,
  UPDATE_INSTALL_RETRY_MS,
} from '../../apps/print-agent/src/desktop/main/update-manager';
import type { ShutdownCoordinator } from '../../apps/print-agent/src/desktop/main/shutdown-coordinator';

class MockAppUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowDowngrade = false;
  allowPrerelease = false;
  logger: any = null;

  checkForUpdates = vi.fn().mockImplementation(async () => {
    this.emit('checking-for-update');
    return null;
  });

  downloadUpdate = vi.fn().mockImplementation(async () => {
    return [];
  });

  quitAndInstall = vi.fn();
}

const noop = () => {};
const quietLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function localTime(day: number, hour: number, minute = 0, second = 0): Date {
  return new Date(2026, 7, day, hour, minute, second, 0);
}

function createScheduledManager(
  updater: MockAppUpdater,
  requestQuit: ReturnType<typeof vi.fn>,
): UpdateManager {
  return new UpdateManager({
    autoUpdater: updater as any,
    isPackaged: true,
    isPortable: false,
    currentVersion: '0.5.0',
    platform: 'win32',
    shutdownCoordinator: { requestQuit } as any,
    logger: quietLogger as any,
  });
}

function successfulQuit() {
  return vi.fn().mockImplementation(async (_reason, onReadyToQuit, _timeout, canProceed) => {
    if (canProceed && !canProceed()) return false;
    await onReadyToQuit?.();
    return true;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('UpdateManager Unit Tests', () => {
  it('disables update manager when app is unpackaged', async () => {
    const mockUpdater = new MockAppUpdater();
    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: false,
      isPortable: false,
      currentVersion: '0.5.0',
    });

    const state = manager.getState();
    expect(state.status).toBe('DISABLED');
    expect(state.errorCode).toBe('UPDATE_DISABLED');

    await manager.checkForUpdates();
    expect(mockUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('disables update manager on portable build', async () => {
    const mockUpdater = new MockAppUpdater();
    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: true,
      currentVersion: '0.5.0',
    });

    const state = manager.getState();
    expect(state.status).toBe('DISABLED');
    expect(state.errorCode).toBe('UPDATE_UNSUPPORTED_PORTABLE');

    await manager.checkForUpdates();
    expect(mockUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('handles update check: UP_TO_DATE', async () => {
    const mockUpdater = new MockAppUpdater();
    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: false,
      currentVersion: '0.5.0',
    });

    expect(manager.getState().status).toBe('IDLE');

    const checkPromise = manager.checkForUpdates();
    expect(mockUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    mockUpdater.emit('update-not-available', { version: '0.5.0' });
    await checkPromise;

    const state = manager.getState();
    expect(state.status).toBe('UP_TO_DATE');
    expect(state.availableVersion).toBeNull();
  });

  it('handles update check: AVAILABLE -> automatic background download -> DOWNLOADED', async () => {
    const mockUpdater = new MockAppUpdater();
    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: false,
      currentVersion: '0.5.0',
    });

    const checkPromise = manager.checkForUpdates();

    mockUpdater.emit('update-available', {
      version: '0.5.1',
      releaseNotes: 'Bug fixes',
    });
    await checkPromise;

    expect(mockUpdater.downloadUpdate).toHaveBeenCalled();
    expect(manager.getState().status).toBe('DOWNLOADING');
    expect(manager.getState().availableVersion).toBe('0.5.1');

    // Progress
    mockUpdater.emit('download-progress', {
      percent: 45.6,
      transferred: 45000,
      total: 100000,
    });
    expect(manager.getState().status).toBe('DOWNLOADING');
    expect(manager.getState().progressPercent).toBe(46);

    // Download complete
    mockUpdater.emit('update-downloaded', { version: '0.5.1' });
    expect(manager.getState().status).toBe('DOWNLOADED');
    expect(manager.getState().progressPercent).toBe(100);
  });

  it('coalesces duplicate concurrent checkForUpdates calls', async () => {
    const mockUpdater = new MockAppUpdater();
    let resolveCheck: (val: any) => void = noop;
    mockUpdater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
    );

    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: false,
      currentVersion: '0.5.0',
    });

    const p1 = manager.checkForUpdates();
    const p2 = manager.checkForUpdates();

    expect(mockUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    resolveCheck(null);
    mockUpdater.emit('update-not-available', { version: '0.5.0' });

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.status).toBe('UP_TO_DATE');
    expect(res2.status).toBe('UP_TO_DATE');
  });

  it('maps specific error codes (ENOTFOUND, 404, 403, timeout, TLS, checksum) correctly', async () => {
    const errorTestCases = [
      { raw: 'getaddrinfo ENOTFOUND updates.propos.vn', expectedCode: 'UPDATE_SERVER_NOT_FOUND' },
      { raw: 'Cannot find latest.yml, status code 404', expectedCode: 'UPDATE_FEED_NOT_FOUND' },
      { raw: 'HTTP 403 Forbidden on latest.yml', expectedCode: 'UPDATE_FORBIDDEN' },
      { raw: 'connect ETIMEDOUT 104.21.5.12', expectedCode: 'UPDATE_TIMEOUT' },
      { raw: 'CERT_HAS_EXPIRED on SSL handshake', expectedCode: 'UPDATE_TLS_ERROR' },
      {
        raw: 'SHA512 checksum mismatch for installer binary',
        expectedCode: 'UPDATE_CHECKSUM_FAILED',
      },
    ];

    for (const { raw, expectedCode } of errorTestCases) {
      const mockUpdater = new MockAppUpdater();
      const manager = new UpdateManager({
        autoUpdater: mockUpdater as any,
        isPackaged: true,
        isPortable: false,
        currentVersion: '0.5.1',
      });

      const checkPromise = manager.checkForUpdates();
      mockUpdater.emit('error', new Error(raw));
      await checkPromise;

      const state = manager.getState();
      expect(state.status).toBe('ERROR');
      expect(state.errorCode).toBe(expectedCode);
    }
  });

  it('executes installUpdate via ShutdownCoordinator when queue drains', async () => {
    const mockUpdater = new MockAppUpdater();
    const mockCoordinator: Partial<ShutdownCoordinator> = {
      requestQuit: vi.fn().mockImplementation(async (_reason, onReadyToQuit) => {
        if (onReadyToQuit) await onReadyToQuit();
        return true;
      }),
    };

    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: false,
      currentVersion: '0.5.0',
      shutdownCoordinator: mockCoordinator as any,
    });

    // Simulate downloaded state
    mockUpdater.emit('update-downloaded', { version: '0.5.1' });
    expect(manager.getState().status).toBe('DOWNLOADED');

    await manager.installUpdate();

    expect(mockCoordinator.requestQuit).toHaveBeenCalledWith('UPDATE', expect.any(Function), 30000);
    expect(mockUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(manager.getState().status).toBe('INSTALLING');
  });

  it('cancels installUpdate and reports error when ShutdownCoordinator returns DRAIN_TIMEOUT', async () => {
    const mockUpdater = new MockAppUpdater();
    const mockCoordinator: Partial<ShutdownCoordinator> = {
      requestQuit: vi.fn().mockResolvedValue(false),
    };

    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: false,
      currentVersion: '0.5.0',
      shutdownCoordinator: mockCoordinator as any,
    });

    // Simulate downloaded state
    mockUpdater.emit('update-downloaded', { version: '0.5.1' });
    expect(manager.getState().status).toBe('DOWNLOADED');

    await manager.installUpdate();

    expect(mockCoordinator.requestQuit).toHaveBeenCalledWith('UPDATE', expect.any(Function), 30000);
    expect(mockUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('ERROR');
    expect(manager.getState().errorCode).toBe('UPDATE_DRAIN_TIMEOUT');
  });

  it('keeps an update downloaded at 15:00 pending without automatic install', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(31, 15));
    const updater = new MockAppUpdater();
    const requestQuit = successfulQuit();
    const manager = createScheduledManager(updater, requestQuit);

    updater.emit('update-downloaded', { version: '0.6.0' });
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.getState()).toMatchObject({
      status: 'DOWNLOADED',
      automaticInstallScheduled: true,
      maintenanceWindowActive: false,
    });
    expect(requestQuit).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('runs the daily background update check at 23:45 local time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(31, 23, 44, 59));
    const updater = new MockAppUpdater();
    const manager = createScheduledManager(updater, successfulQuit());
    manager.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it('installs at local midnight when the print queue is idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(31, 23, 59, 59));
    const updater = new MockAppUpdater();
    const requestQuit = successfulQuit();
    const manager = createScheduledManager(updater, requestQuit);
    manager.start();
    updater.emit('update-downloaded', { version: '0.6.0' });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(requestQuit).toHaveBeenCalledWith(
      'UPDATE',
      expect.any(Function),
      30_000,
      expect.any(Function),
    );
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    manager.stop();
  });

  it('does not install on a busy queue at 00:00 and schedules a retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(31, 23, 59, 59));
    const updater = new MockAppUpdater();
    const requestQuit = vi.fn().mockResolvedValue(false);
    const manager = createScheduledManager(updater, requestQuit);
    manager.start();
    updater.emit('update-downloaded', { version: '0.6.0' });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({
      status: 'DOWNLOADED',
      maintenanceWindowActive: true,
    });

    await vi.advanceTimersByTimeAsync(UPDATE_INSTALL_RETRY_MS - 1);
    expect(requestQuit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestQuit).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it('installs when the queue becomes idle on the 00:10 retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(31, 23, 59, 59));
    const updater = new MockAppUpdater();
    const requestQuit = vi.fn().mockImplementation(async (_reason, onReadyToQuit) => {
      if (requestQuit.mock.calls.length < 3) {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        return false;
      }
      await onReadyToQuit();
      return true;
    });
    const manager = createScheduledManager(updater, requestQuit);
    manager.start();
    updater.emit('update-downloaded', { version: '0.6.0' });

    await vi.advanceTimersByTimeAsync(1_000 + UPDATE_INSTALL_RETRY_MS * 2);

    expect(requestQuit).toHaveBeenCalledTimes(3);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it('stops automatic retries at 02:00 and keeps the package downloaded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(1, 1, 55));
    const updater = new MockAppUpdater();
    const requestQuit = vi.fn().mockResolvedValue(false);
    const manager = createScheduledManager(updater, requestQuit);
    manager.start();
    updater.emit('update-downloaded', { version: '0.6.0' });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestQuit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({
      status: 'DOWNLOADED',
      maintenanceWindowActive: false,
    });
    manager.stop();
  });

  it('installs after Windows resumes at 00:30 with a downloaded update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(1, 23, 50));
    const updater = new MockAppUpdater();
    const requestQuit = successfulQuit();
    const manager = createScheduledManager(updater, requestQuit);
    manager.start();
    updater.emit('update-downloaded', { version: '0.6.0' });

    vi.setSystemTime(localTime(2, 0, 30));
    manager.handleResume();
    await vi.advanceTimersByTimeAsync(0);

    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it('does not automatically install after Windows resumes at 08:00', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(1, 23, 50));
    const updater = new MockAppUpdater();
    const requestQuit = successfulQuit();
    const manager = createScheduledManager(updater, requestQuit);
    manager.start();
    updater.emit('update-downloaded', { version: '0.6.0' });

    vi.setSystemTime(localTime(2, 8));
    manager.handleResume();
    await vi.advanceTimersByTimeAsync(0);

    expect(requestQuit).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    manager.stop();
  });

  it('checks immediately when opened during the maintenance window and installs after download', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(localTime(1, 0, 30));
    const updater = new MockAppUpdater();
    const requestQuit = successfulQuit();
    const manager = createScheduledManager(updater, requestQuit);

    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    updater.emit('update-available', { version: '0.6.0' });
    updater.emit('update-downloaded', { version: '0.6.0' });
    await vi.advanceTimersByTimeAsync(0);

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    manager.stop();
  });
});
