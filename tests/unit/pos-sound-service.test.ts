import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SOUND_FILES, SoundManager } from '@client/lib/sound';

class MockDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  hidden = false;

  setVisible(visible: boolean): void {
    this.visibilityState = visible ? 'visible' : 'hidden';
    this.hidden = !visible;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

interface MockSource {
  buffer: AudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
}

const decodedBuffer = { length: 128, sampleRate: 44_100 } as AudioBuffer;

class MockAudioContext extends EventTarget {
  static initialState: AudioContextState = 'suspended';
  static decodeFails = false;
  static instances: MockAudioContext[] = [];

  state = MockAudioContext.initialState;
  currentTime = 10;
  sampleRate = 44_100;
  destination = {} as AudioDestinationNode;
  sources: MockSource[] = [];
  oscillatorStarts: Array<ReturnType<typeof vi.fn>> = [];

  resume = vi.fn(async () => {
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  });

  decodeAudioData = vi.fn(async () => {
    if (MockAudioContext.decodeFails) throw new Error('decode failed');
    return decodedBuffer;
  });

  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
    return { numberOfChannels: channels, length, sampleRate } as AudioBuffer;
  });

  createBufferSource = vi.fn(() => {
    const source: MockSource = {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    };
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  });

  createGain = vi.fn(
    () =>
      ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }) as unknown as GainNode,
  );

  createOscillator = vi.fn(() => {
    const start = vi.fn();
    this.oscillatorStarts.push(start);
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start,
      stop: vi.fn(),
    } as unknown as OscillatorNode;
  });

  constructor() {
    super();
    MockAudioContext.instances.push(this);
  }
}

const storage = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
};

const audioElementPlay = vi.fn();
const audioElementConstructor = vi.fn(() => ({ play: audioElementPlay }));
const fetchMock = vi.fn(async (_path: string, _options?: RequestInit) => {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  };
});

let documentMock: MockDocument;
let windowMock: EventTarget;
let managers: SoundManager[];

function createManager(state: AudioContextState = 'suspended'): {
  manager: SoundManager;
  context: MockAudioContext;
} {
  MockAudioContext.initialState = state;
  const manager = new SoundManager();
  managers.push(manager);
  const context = MockAudioContext.instances.at(-1);
  if (!context) throw new Error('AudioContext was not created');

  // Unit tests do not need to wait for the production overlap throttle.
  (manager as unknown as { MIN_INTERVAL_MS: number }).MIN_INTERVAL_MS = 0;
  return { manager, context };
}

async function unlockAndIgnoreSilentSource(
  manager: SoundManager,
  context: MockAudioContext,
): Promise<void> {
  await expect(manager.unlock()).resolves.toBe(true);
  context.sources.length = 0;
  context.oscillatorStarts.length = 0;
}

function startedDecodedSources(context: MockAudioContext): MockSource[] {
  return context.sources.filter(
    (source) => source.buffer === decodedBuffer && source.start.mock.calls.length > 0,
  );
}

beforeEach(() => {
  managers = [];
  storage.clear();
  MockAudioContext.instances = [];
  MockAudioContext.decodeFails = false;
  fetchMock.mockClear();
  audioElementPlay.mockClear();
  audioElementConstructor.mockClear();

  documentMock = new MockDocument();
  windowMock = Object.assign(new EventTarget(), {
    AudioContext: MockAudioContext,
    localStorage: mockLocalStorage,
    setTimeout,
    clearTimeout,
  });

  vi.stubGlobal('document', documentMock);
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Audio', audioElementConstructor);
});

afterEach(() => {
  for (const manager of managers) manager.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POS Web Audio sound service', () => {
  it('initializes and preloads without playing any real notification sound', () => {
    const { context } = createManager();

    expect(fetchMock).toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    expect(audioElementConstructor).not.toHaveBeenCalled();
    expect(audioElementPlay).not.toHaveBeenCalled();
  });

  it('unlocks without calling HTMLAudioElement.play()', async () => {
    const { manager } = createManager();

    await manager.unlock();

    expect(audioElementConstructor).not.toHaveBeenCalled();
    expect(audioElementPlay).not.toHaveBeenCalled();
  });

  it('uses a genuinely silent one-frame AudioBuffer for warm-up', async () => {
    const { manager, context } = createManager();

    await manager.unlock();

    expect(context.createBuffer).toHaveBeenCalledWith(1, 1, context.sampleRate);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.buffer?.length).toBe(1);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0);
  });

  it('serializes resume while moving a suspended context to running', async () => {
    const { manager, context } = createManager('suspended');

    const results = await Promise.all([manager.unlock(), manager.unlock(), manager.unlock()]);

    expect(results).toEqual([true, true, true]);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.state).toBe('running');
  });

  it('does not play while muted', async () => {
    const { manager, context } = createManager();
    await unlockAndIgnoreSilentSource(manager, context);
    manager.setMuted(true);

    manager.play('NEW_QR_ORDER', { dedupeKey: 'muted-order' });
    await Promise.resolve();

    expect(startedDecodedSources(context)).toHaveLength(0);
    expect(context.oscillatorStarts).toHaveLength(0);
  });

  it('plays a duplicate dedupeKey only once', async () => {
    const { manager, context } = createManager();
    await unlockAndIgnoreSilentSource(manager, context);

    manager.play('NEW_QR_ORDER', { dedupeKey: 'order-123' });
    manager.play('NEW_QR_ORDER', { dedupeKey: 'order-123' });
    manager.play('NEW_QR_ORDER', { dedupeKey: 'order-123' });

    await vi.waitFor(() => expect(startedDecodedSources(context)).toHaveLength(1));
  });

  it('plays two distinct events independently', async () => {
    const { manager, context } = createManager();
    await unlockAndIgnoreSilentSource(manager, context);

    manager.play('NEW_QR_ORDER', { dedupeKey: 'order-1' });
    manager.play('PAYMENT_SUCCESS', { dedupeKey: 'payment-1' });

    await vi.waitFor(() => expect(startedDecodedSources(context)).toHaveLength(2));
  });

  it('drops hidden/background events instead of queueing a foreground backlog', async () => {
    const { manager, context } = createManager();
    await unlockAndIgnoreSilentSource(manager, context);
    documentMock.setVisible(false);

    manager.play('NEW_QR_ORDER', { dedupeKey: 'background-order' });
    documentMock.setVisible(true);
    await Promise.resolve();

    expect(startedDecodedSources(context)).toHaveLength(0);

    manager.play('NEW_QR_ORDER', { dedupeKey: 'foreground-order' });
    await vi.waitFor(() => expect(startedDecodedSources(context)).toHaveLength(1));
  });

  it('discards a queued event after its five-second TTL', async () => {
    const { manager, context } = createManager();
    await unlockAndIgnoreSilentSource(manager, context);
    const internals = manager as unknown as {
      isPlaying: boolean;
      playQueue: Array<{ enqueuedAt: number }>;
      processQueue: () => Promise<void>;
    };
    internals.isPlaying = true;
    manager.play('NEW_QR_ORDER', { dedupeKey: 'stale-order' });
    internals.playQueue[0]!.enqueuedAt = Date.now() - 5_001;
    internals.isPlaying = false;

    await internals.processQueue();

    expect(startedDecodedSources(context)).toHaveLength(0);
    expect(internals.playQueue).toHaveLength(0);
  });

  it('uses a synthesized chime when fetch/decode fails', async () => {
    MockAudioContext.decodeFails = true;
    const { manager, context } = createManager();
    await unlockAndIgnoreSilentSource(manager, context);

    manager.play('NEW_QR_ORDER', { dedupeKey: 'decode-error' });

    await vi.waitFor(() => expect(context.oscillatorStarts).toHaveLength(2));
    expect(startedDecodedSources(context)).toHaveLength(0);
  });

  it('fetches and decodes each unique sound path only once', async () => {
    const { manager } = createManager();
    manager.initialize();
    const uniquePaths = new Set(Object.values(SOUND_FILES));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(uniquePaths.size));
    for (const path of uniquePaths) {
      expect(fetchMock.mock.calls.filter(([requestedPath]) => requestedPath === path)).toHaveLength(
        1,
      );
    }
  });
});
