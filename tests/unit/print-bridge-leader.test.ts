import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDesktopPlatform,
  isPrintBridgeEnabled,
  isPrintBridgeLeader,
  setPrintBridgeEnabled,
  startPrintBridgeLeaderElection,
  stopPrintBridgeLeaderElection,
  subscribePrintBridgeLeader,
} from '../../src/client/lib/print-bridge-service';

describe('Print Bridge Client & Leader Election', () => {
  let memoryStorage: Record<string, string>;

  beforeEach(() => {
    memoryStorage = {};
    const mockStorage = {
      getItem: (key: string) => memoryStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        memoryStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete memoryStorage[key];
      },
      clear: () => {
        memoryStorage = {};
      },
    };

    vi.stubGlobal('window', {
      localStorage: mockStorage,
    });
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });

    stopPrintBridgeLeaderElection();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects desktop platform and defaults bridge accordingly', () => {
    const isDesktop = isDesktopPlatform();
    expect(isDesktop).toBe(true);

    const enabled = isPrintBridgeEnabled();
    expect(enabled).toBe(true);
  });

  it('allows enabling and disabling print bridge in local storage', () => {
    setPrintBridgeEnabled(true);
    expect(isPrintBridgeEnabled()).toBe(true);

    setPrintBridgeEnabled(false);
    expect(isPrintBridgeEnabled()).toBe(false);
  });

  it('notifies subscribers when leader state changes', async () => {
    stopPrintBridgeLeaderElection();
    expect(isPrintBridgeLeader()).toBe(false);

    const notifications: boolean[] = [];
    const unsubscribe = subscribePrintBridgeLeader((leader) => {
      notifications.push(leader);
    });

    expect(notifications).toEqual([false]);

    await startPrintBridgeLeaderElection();
    expect(isPrintBridgeLeader()).toBe(true);
    expect(notifications).toContain(true);

    stopPrintBridgeLeaderElection();
    expect(isPrintBridgeLeader()).toBe(false);
    expect(notifications.at(-1)).toBe(false);

    unsubscribe();
  });
});
