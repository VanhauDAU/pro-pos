import { describe, expect, it, vi } from 'vitest';
import {
  ShutdownCoordinator,
  type ShutdownRuntimeTarget,
} from '../../apps/print-agent/src/desktop/main/shutdown-coordinator';

const noop = () => {};

describe('ShutdownCoordinator Unit Tests', () => {
  it('handles NORMAL quit by gracefully stopping runtime and calling quitApp', async () => {
    const mockRuntime: ShutdownRuntimeTarget = {
      stop: vi.fn().mockResolvedValue(undefined),
      stopGracefully: vi.fn().mockResolvedValue('SUCCESS'),
      getPendingPrintJobCount: vi.fn().mockReturnValue(0),
      isPrintIdle: vi.fn().mockReturnValue(true),
    };

    const quitApp = vi.fn();
    const coordinator = new ShutdownCoordinator(mockRuntime, quitApp);

    expect(coordinator.getState()).toBe('RUNNING');
    expect(coordinator.isPermittedToQuit()).toBe(false);

    const result = await coordinator.requestQuit('NORMAL');
    expect(result).toBe(true);
    expect(mockRuntime.stopGracefully).toHaveBeenCalledWith({ timeoutMs: 5000 });
    expect(coordinator.isPermittedToQuit()).toBe(true);
    expect(coordinator.getState()).toBe('QUITTING');
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('handles UPDATE quit when queue drains successfully', async () => {
    const mockRuntime: ShutdownRuntimeTarget = {
      stop: vi.fn().mockResolvedValue(undefined),
      stopGracefully: vi.fn().mockResolvedValue('SUCCESS'),
      getPendingPrintJobCount: vi.fn().mockReturnValue(0),
      isPrintIdle: vi.fn().mockReturnValue(true),
    };

    const quitApp = vi.fn();
    const coordinator = new ShutdownCoordinator(mockRuntime, quitApp);
    const onReadyToQuit = vi.fn().mockResolvedValue(undefined);

    const result = await coordinator.requestQuit('UPDATE', onReadyToQuit, 30_000);
    expect(result).toBe(true);
    expect(mockRuntime.stopGracefully).toHaveBeenCalledWith({ timeoutMs: 30000 });
    expect(onReadyToQuit).toHaveBeenCalledTimes(1);
    expect(coordinator.isPermittedToQuit()).toBe(true);
    expect(coordinator.getState()).toBe('READY_TO_QUIT');
    // quitApp is not called automatically when onReadyToQuit is provided (e.g. autoUpdater.quitAndInstall will handle quit)
    expect(quitApp).not.toHaveBeenCalled();
  });

  it('handles UPDATE quit DRAIN_TIMEOUT by aborting quit and returning false', async () => {
    const mockRuntime: ShutdownRuntimeTarget = {
      stop: vi.fn().mockResolvedValue(undefined),
      stopGracefully: vi.fn().mockResolvedValue('DRAIN_TIMEOUT'),
      getPendingPrintJobCount: vi.fn().mockReturnValue(2),
      isPrintIdle: vi.fn().mockReturnValue(false),
    };

    const quitApp = vi.fn();
    const coordinator = new ShutdownCoordinator(mockRuntime, quitApp);
    const onReadyToQuit = vi.fn().mockResolvedValue(undefined);

    const result = await coordinator.requestQuit('UPDATE', onReadyToQuit, 30_000);
    expect(result).toBe(false);
    expect(mockRuntime.stopGracefully).toHaveBeenCalledWith({ timeoutMs: 30000 });
    expect(onReadyToQuit).not.toHaveBeenCalled();
    expect(coordinator.isPermittedToQuit()).toBe(false);
    expect(coordinator.getState()).toBe('RUNNING');
    expect(quitApp).not.toHaveBeenCalled();
  });

  it('coalesces duplicate in-flight quit requests', async () => {
    let resolveDrain: (res: 'SUCCESS') => void = noop;
    const drainPromise = new Promise<'SUCCESS'>((r) => {
      resolveDrain = r;
    });

    const mockRuntime: ShutdownRuntimeTarget = {
      stop: vi.fn().mockResolvedValue(undefined),
      stopGracefully: vi.fn().mockImplementation(() => drainPromise),
      getPendingPrintJobCount: vi.fn().mockReturnValue(1),
      isPrintIdle: vi.fn().mockReturnValue(false),
    };

    const quitApp = vi.fn();
    const coordinator = new ShutdownCoordinator(mockRuntime, quitApp);

    const p1 = coordinator.requestQuit('UPDATE');
    const p2 = coordinator.requestQuit('UPDATE');

    expect(coordinator.getState()).toBe('DRAINING');

    resolveDrain('SUCCESS');

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(mockRuntime.stopGracefully).toHaveBeenCalledTimes(1);
  });

  it('restores the runtime when the maintenance window closes during drain', async () => {
    let maintenanceWindowActive = true;
    const mockRuntime: ShutdownRuntimeTarget = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      stopGracefully: vi.fn().mockImplementation(async () => {
        maintenanceWindowActive = false;
        return 'SUCCESS';
      }),
      getPendingPrintJobCount: vi.fn().mockReturnValue(0),
      isPrintIdle: vi.fn().mockReturnValue(true),
    };
    const onReadyToQuit = vi.fn();
    const coordinator = new ShutdownCoordinator(mockRuntime, vi.fn());

    const result = await coordinator.requestQuit(
      'UPDATE',
      onReadyToQuit,
      30_000,
      () => maintenanceWindowActive,
    );

    expect(result).toBe(false);
    expect(mockRuntime.start).toHaveBeenCalledOnce();
    expect(onReadyToQuit).not.toHaveBeenCalled();
    expect(coordinator.getState()).toBe('RUNNING');
    expect(coordinator.isPermittedToQuit()).toBe(false);
  });

  it('restores the runtime when the updater fails to start installation', async () => {
    const mockRuntime: ShutdownRuntimeTarget = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      stopGracefully: vi.fn().mockResolvedValue('SUCCESS'),
      getPendingPrintJobCount: vi.fn().mockReturnValue(0),
      isPrintIdle: vi.fn().mockReturnValue(true),
    };
    const coordinator = new ShutdownCoordinator(mockRuntime, vi.fn());

    await expect(
      coordinator.requestQuit('UPDATE', () => {
        throw new Error('quitAndInstall failed');
      }),
    ).rejects.toThrow('quitAndInstall failed');

    expect(mockRuntime.start).toHaveBeenCalledOnce();
    expect(coordinator.getState()).toBe('RUNNING');
    expect(coordinator.isPermittedToQuit()).toBe(false);
  });
});
