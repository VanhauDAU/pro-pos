import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { UpdateManager } from '../../apps/print-agent/src/desktop/main/update-manager';
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

  it('maps checksum mismatch errors correctly', async () => {
    const mockUpdater = new MockAppUpdater();
    const manager = new UpdateManager({
      autoUpdater: mockUpdater as any,
      isPackaged: true,
      isPortable: false,
      currentVersion: '0.5.0',
    });

    const checkPromise = manager.checkForUpdates();
    mockUpdater.emit('error', new Error('SHA512 checksum mismatch for installer binary'));
    await checkPromise;

    const state = manager.getState();
    expect(state.status).toBe('ERROR');
    expect(state.errorCode).toBe('UPDATE_CHECKSUM_FAILED');
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
});
