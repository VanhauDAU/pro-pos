/**
 * Centralized POS sound service backed by a single Web Audio API context.
 *
 * Loading and decoding never starts playback. Audio is unlocked only by resuming
 * the context from a user gesture and playing a genuinely silent, one-frame buffer.
 */

export type PosSoundType =
  | 'NEW_QR_ORDER'
  | 'PAYMENT_SUCCESS'
  | 'TABLE_OPEN_REQUEST'
  | 'CALL_STAFF'
  | 'CHECKOUT_REQUEST'
  | 'NOTIFICATION_CHIME'
  | 'GUEST_ORDER_SENT'
  | 'GUEST_CHECKOUT_REQUEST_SENT'
  | 'GUEST_QR_OPEN_REQUESTED';

export const SOUND_FILES: Record<Exclude<PosSoundType, 'NOTIFICATION_CHIME'>, string> = {
  NEW_QR_ORDER: '/sounds/sound_goimonmoi.mp3',
  PAYMENT_SUCCESS: '/sounds/sound_thanhtoanthanhcong.mp3',
  TABLE_OPEN_REQUEST: '/sounds/sound_yeuccaumoban.mp3',
  CALL_STAFF: '/sounds/sound_yeuccaumoban.mp3',
  CHECKOUT_REQUEST: '/sounds/sound_yeucauthanhtoan.mp3',
  GUEST_ORDER_SENT: '/sounds/guest-order-sent.mp3',
  GUEST_CHECKOUT_REQUEST_SENT: '/sounds/guest-checkout-request-sent.mp3',
  GUEST_QR_OPEN_REQUESTED: '/sounds/guest_qr_open_requested.mp3',
};

interface QueueItem {
  type: PosSoundType;
  volume: number | undefined;
  enqueuedAt: number;
}

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const GESTURE_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'touchend', 'click', 'keydown'];

export class SoundManager {
  private audioContext: AudioContext | null = null;
  private readonly audioBuffers = new Map<PosSoundType, AudioBuffer>();
  private readonly preloadByPath = new Map<string, Promise<AudioBuffer | null>>();
  private isUnlocked = false;
  private unlockPromise: Promise<boolean> | null = null;
  private silentWarmupComplete = false;
  private initialized = false;
  private gestureListenersArmed = false;
  private lastForegroundResumeAttempt = 0;

  private readonly seenKeys = new Map<string, number>();
  private readonly DEDUPE_TTL_MS = 5 * 60 * 1000;

  private readonly playQueue: QueueItem[] = [];
  private isPlaying = false;
  private queueTimer: number | null = null;
  private lastPlayTime = 0;
  private readonly MIN_INTERVAL_MS = 350;
  private readonly SOUND_TTL_MS = 5_000;
  private readonly DEFAULT_VOLUME = 0.5;
  private readonly MAX_QUEUE_SIZE = 4;

  private isMuted = false;

  constructor() {
    this.initialize();
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Idempotent so React remounts and HMR cannot duplicate browser listeners or fetches. */
  initialize(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    try {
      this.isMuted = window.localStorage.getItem('propos:sound:muted') === 'true';
    } catch {
      this.isMuted = false;
    }

    this.getAudioContext();
    this.armGestureUnlock();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handleForeground);
    window.addEventListener('focus', this.handleForeground);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    try {
      window.localStorage.setItem('propos:sound:muted', String(muted));
    } catch {
      // Storage may be disabled in private browsing or an embedded webview.
    }
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;
    if (typeof window === 'undefined') return null;

    const AudioContextConstructor =
      window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    try {
      this.audioContext = new AudioContextConstructor();
      this.audioContext.addEventListener?.('statechange', this.handleContextStateChange);
      return this.audioContext;
    } catch {
      return null;
    }
  }

  warm(types: Array<Exclude<PosSoundType, 'NOTIFICATION_CHIME'>>): void {
    for (const type of types) void this.preload(type);
  }

  private preload(type: Exclude<PosSoundType, 'NOTIFICATION_CHIME'>): Promise<AudioBuffer | null> {
    const cached = this.audioBuffers.get(type);
    if (cached) return Promise.resolve(cached);

    const path = SOUND_FILES[type];
    let promise = this.preloadByPath.get(path);
    if (!promise) {
      promise = this.fetchAndDecode(path);
      this.preloadByPath.set(path, promise);
    }

    return promise.then((buffer) => {
      if (buffer) this.audioBuffers.set(type, buffer);
      return buffer;
    });
  }

  private async fetchAndDecode(path: string): Promise<AudioBuffer | null> {
    const context = this.getAudioContext();
    if (!context || typeof fetch !== 'function') return null;

    try {
      const response = await fetch(path, { cache: 'force-cache' });
      if (!response.ok) return null;
      const encoded = await response.arrayBuffer();
      return await context.decodeAudioData(encoded.slice(0));
    } catch {
      return null;
    }
  }

  private armGestureUnlock(): void {
    if (this.gestureListenersArmed || typeof window === 'undefined') return;
    this.gestureListenersArmed = true;
    for (const eventName of GESTURE_EVENTS) {
      window.addEventListener(eventName, this.handleGesture, {
        capture: true,
        passive: true,
      });
    }
  }

  private disarmGestureUnlock(): void {
    if (!this.gestureListenersArmed || typeof window === 'undefined') return;
    this.gestureListenersArmed = false;
    for (const eventName of GESTURE_EVENTS) {
      window.removeEventListener(eventName, this.handleGesture, true);
    }
  }

  private readonly handleGesture = (): void => {
    void this.unlock();
  };

  /**
   * Resume calls are serialized. The only warm-up source is a zero-filled,
   * one-frame AudioBuffer; notification files are never used for unlocking.
   */
  async unlock(): Promise<boolean> {
    if (this.isUnlocked && this.audioContext?.state === 'running') return true;
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = (async () => {
      const context = this.getAudioContext();
      if (!context || context.state === 'closed') return false;

      try {
        if (context.state !== 'running') await context.resume();
        if (context.state !== 'running') return false;

        if (!this.silentWarmupComplete) {
          const silentBuffer = context.createBuffer(1, 1, context.sampleRate);
          const silentSource = context.createBufferSource();
          silentSource.buffer = silentBuffer;
          silentSource.connect(context.destination);
          silentSource.start(0);
          this.silentWarmupComplete = true;
        }

        this.isUnlocked = true;
        this.disarmGestureUnlock();
        return true;
      } catch {
        this.isUnlocked = false;
        this.armGestureUnlock();
        return false;
      }
    })().finally(() => {
      this.unlockPromise = null;
    });

    return this.unlockPromise;
  }

  private readonly handleContextStateChange = (): void => {
    const running = this.audioContext?.state === 'running';
    this.isUnlocked = running;
    if (running) {
      this.disarmGestureUnlock();
    } else if (this.isForeground()) {
      this.armGestureUnlock();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (!this.isForeground()) {
      this.dropQueuedSounds();
      return;
    }
    this.tryResumeOnForeground();
  };

  private readonly handleForeground = (): void => {
    if (this.isForeground()) this.tryResumeOnForeground();
  };

  private tryResumeOnForeground(): void {
    const context = this.audioContext;
    if (!context || context.state === 'running' || context.state === 'closed') return;

    // visibilitychange, pageshow and focus often arrive together on mobile.
    const now = Date.now();
    if (now - this.lastForegroundResumeAttempt < 1_000) {
      this.armGestureUnlock();
      return;
    }
    this.lastForegroundResumeAttempt = now;
    void this.unlock().then((unlocked) => {
      if (!unlocked) this.armGestureUnlock();
    });
  }

  private isForeground(): boolean {
    if (typeof document === 'undefined') return false;
    return document.visibilityState === 'visible' && !document.hidden;
  }

  private cleanOldDedupeKeys(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seenKeys) {
      if (now - timestamp > this.DEDUPE_TTL_MS) this.seenKeys.delete(key);
    }
  }

  play(
    type: PosSoundType,
    options?: {
      dedupeKey?: string;
      volume?: number;
      force?: boolean;
    },
  ): void {
    if (typeof window === 'undefined' || (this.isMuted && !options?.force)) return;

    // Mark the event before checking foreground/audio state. A background event
    // must remain silent if polling or realtime delivers it again after resume.
    if (options?.dedupeKey) {
      this.cleanOldDedupeKeys();
      if (this.seenKeys.has(options.dedupeKey)) return;
      this.seenKeys.set(options.dedupeKey, Date.now());
    }

    if (!this.canPlayNow()) {
      this.dropQueuedSounds();
      if (this.audioContext?.state !== 'running') this.armGestureUnlock();
      return;
    }

    if (this.playQueue.length >= this.MAX_QUEUE_SIZE) this.playQueue.shift();
    this.playQueue.push({ type, volume: options?.volume, enqueuedAt: Date.now() });
    void this.processQueue();
  }

  private canPlayNow(enqueuedAt?: number): boolean {
    if (!this.isForeground() || this.audioContext?.state !== 'running' || !this.isUnlocked) {
      return false;
    }
    return enqueuedAt === undefined || Date.now() - enqueuedAt <= this.SOUND_TTL_MS;
  }

  private dropQueuedSounds(): void {
    this.playQueue.length = 0;
    if (this.queueTimer !== null) {
      window.clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.queueTimer !== null) return;

    let firstItem = this.playQueue.at(0);
    while (firstItem && !this.canPlayNow(firstItem.enqueuedAt)) {
      this.playQueue.shift();
      firstItem = this.playQueue.at(0);
    }
    if (this.playQueue.length === 0) return;
    if (!this.canPlayNow()) {
      this.dropQueuedSounds();
      return;
    }

    const delay = Math.max(0, this.MIN_INTERVAL_MS - (Date.now() - this.lastPlayTime));
    if (delay > 0) {
      this.queueTimer = window.setTimeout(() => {
        this.queueTimer = null;
        void this.processQueue();
      }, delay);
      return;
    }

    const item = this.playQueue.shift();
    if (!item) return;
    this.isPlaying = true;
    try {
      if (await this.executePlay(item)) this.lastPlayTime = Date.now();
    } catch {
      // Sound must never break the notification UI.
    } finally {
      this.isPlaying = false;
      if (this.playQueue.length > 0) {
        this.queueTimer = window.setTimeout(() => {
          this.queueTimer = null;
          void this.processQueue();
        }, 0);
      }
    }
  }

  private async executePlay(item: QueueItem): Promise<boolean> {
    const context = this.audioContext;
    if (!context || !this.canPlayNow(item.enqueuedAt)) return false;

    if (item.type === 'NOTIFICATION_CHIME') {
      return this.playSynthesizedChime(item.volume, item.enqueuedAt);
    }

    const buffer =
      this.audioBuffers.get(item.type) ??
      (await this.preload(item.type as Exclude<PosSoundType, 'NOTIFICATION_CHIME'>));
    if (!this.canPlayNow(item.enqueuedAt)) return false;
    if (!buffer) return this.playSynthesizedChime(item.volume, item.enqueuedAt);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(this.clampVolume(item.volume), context.currentTime);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(0);
    return true;
  }

  private playSynthesizedChime(customVolume?: number, enqueuedAt?: number): boolean {
    const context = this.audioContext;
    if (!context || !this.canPlayNow(enqueuedAt)) return false;

    try {
      const now = context.currentTime;
      const volume = this.clampVolume(customVolume);
      if (volume === 0) return false;

      const oscillatorOne = context.createOscillator();
      const gainOne = context.createGain();
      oscillatorOne.type = 'sine';
      oscillatorOne.frequency.setValueAtTime(587.33, now);
      gainOne.gain.setValueAtTime(Math.max(0.001, 0.12 * volume), now);
      gainOne.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      oscillatorOne.connect(gainOne);
      gainOne.connect(context.destination);
      oscillatorOne.start(now);
      oscillatorOne.stop(now + 0.25);

      const oscillatorTwo = context.createOscillator();
      const gainTwo = context.createGain();
      oscillatorTwo.type = 'sine';
      oscillatorTwo.frequency.setValueAtTime(880, now + 0.08);
      gainTwo.gain.setValueAtTime(Math.max(0.001, 0.16 * volume), now + 0.08);
      gainTwo.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      oscillatorTwo.connect(gainTwo);
      gainTwo.connect(context.destination);
      oscillatorTwo.start(now + 0.08);
      oscillatorTwo.stop(now + 0.35);
      return true;
    } catch {
      return false;
    }
  }

  private clampVolume(volume?: number): number {
    return Math.max(0, Math.min(1, volume ?? this.DEFAULT_VOLUME));
  }

  /** Removes long-lived browser hooks; primarily useful for isolated tests. */
  destroy(): void {
    this.disarmGestureUnlock();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pageshow', this.handleForeground);
      window.removeEventListener('focus', this.handleForeground);
      this.dropQueuedSounds();
    }
    this.audioContext?.removeEventListener?.('statechange', this.handleContextStateChange);
    this.initialized = false;
  }
}

const singletonHost = globalThis as typeof globalThis & {
  proPosSoundManager?: SoundManager;
};

// Storing the instance outside the module prevents duplicate contexts/listeners on Vite HMR.
export const posSound = singletonHost.proPosSoundManager ?? new SoundManager();
singletonHost.proPosSoundManager = posSound;

export function playPosSound(
  type: PosSoundType,
  options?: {
    dedupeKey?: string;
    volume?: number;
    force?: boolean;
  },
): void {
  posSound.play(type, options);
}

export function warmPosSounds(types: Array<Exclude<PosSoundType, 'NOTIFICATION_CHIME'>>): void {
  posSound.warm(types);
}
