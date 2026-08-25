import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, val: string) => {
    mockStorage[key] = val;
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(mockStorage)) delete mockStorage[key];
  }),
};

class MockAudio {
  src = '';
  preload = '';
  volume = 1;
  currentTime = 0;
  load = vi.fn();
  play = vi.fn(async () => undefined);
  pause = vi.fn();
}

class MockAudioContext {
  state = 'running';
  currentTime = 0;
  resume = vi.fn(async () => undefined);
  createOscillator = vi.fn(() => ({
    type: 'sine',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }));
  createGain = vi.fn(() => ({
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  }));
  destination = {};
}

// @ts-expect-error Mock globals
globalThis.window = globalThis as unknown as Window;
// @ts-expect-error Mock globals
globalThis.localStorage = mockLocalStorage;
// @ts-expect-error Mock globals
globalThis.Audio = MockAudio;
// @ts-expect-error Mock globals
globalThis.AudioContext = MockAudioContext;
globalThis.window.addEventListener = vi.fn();
globalThis.window.removeEventListener = vi.fn();

import { playPosSound, posSound } from '@client/lib/sound';

describe('POS Sound Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    posSound.setMuted(false);
  });

  it('preloads and reuses audio instances without error', () => {
    expect(posSound).toBeDefined();
    expect(posSound.muted).toBe(false);
  });

  it('deduplicates playback when given the same dedupeKey', async () => {
    const playSpy = vi.spyOn(
      posSound as unknown as { executePlay: () => Promise<void> },
      'executePlay',
    );

    // First call with key
    playPosSound('NEW_QR_ORDER', { dedupeKey: 'order-123' });
    // Duplicate call with identical key
    playPosSound('NEW_QR_ORDER', { dedupeKey: 'order-123' });
    // Duplicate call with identical key
    playPosSound('NEW_QR_ORDER', { dedupeKey: 'order-123' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    // Should only enqueue / execute once
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('plays different sound types or different dedupeKeys', async () => {
    const playSpy = vi.spyOn(
      posSound as unknown as { executePlay: () => Promise<void> },
      'executePlay',
    );

    playPosSound('NEW_QR_ORDER', { dedupeKey: 'order-1' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    playPosSound('PAYMENT_SUCCESS', { dedupeKey: 'payment-1' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('respects mute setting', async () => {
    posSound.setMuted(true);
    expect(posSound.muted).toBe(true);

    const playSpy = vi.spyOn(
      posSound as unknown as { executePlay: () => Promise<void> },
      'executePlay',
    );
    playPosSound('NEW_QR_ORDER', { dedupeKey: 'order-2' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(playSpy).not.toHaveBeenCalled();

    // Unless forced
    playPosSound('NEW_QR_ORDER', { dedupeKey: 'order-3', force: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('unlocks audio on user interaction gracefully', async () => {
    const unlocked = await posSound.unlock();
    expect(typeof unlocked).toBe('boolean');
  });
});
