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

export interface PlaySoundOptions {
  dedupeKey?: string;
  volume?: number;
  force?: boolean;
  immediate?: boolean;
  allowBackground?: boolean;
}

interface QueueItem {
  type: PosSoundType;
  volume: number | undefined;
  enqueuedAt: number;
}

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const GESTURE_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'touchend', 'click', 'keydown'];

/**
 * Detects whether the current device is a mobile phone (screen width < 768px with touch capability).
 * UI touch feedback sounds are restricted to phones to avoid unwanted noises on desktop cashier terminals.
 */
export function isMobilePhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const isPhoneWidth = window.innerWidth < 768;
  const isTouchDevice =
    'ontouchstart' in window ||
    Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') ||
    Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  return isPhoneWidth && Boolean(isTouchDevice);
}

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

  play(type: PosSoundType, options?: PlaySoundOptions): void {
    if (typeof window === 'undefined' || (this.isMuted && !options?.force)) return;

    // Mark the event before checking foreground/audio state. A background event
    // must remain silent if polling or realtime delivers it again after resume.
    if (options?.dedupeKey) {
      this.cleanOldDedupeKeys();
      if (this.seenKeys.has(options.dedupeKey)) return;
      this.seenKeys.set(options.dedupeKey, Date.now());
    }

    const isPayment = type === 'PAYMENT_SUCCESS';
    const immediate = options?.immediate ?? isPayment;
    const allowBackground = options?.allowBackground ?? isPayment;
    const targetVolume = options?.volume ?? (isPayment ? 1.0 : undefined);

    if (immediate) {
      if (!this.isForeground() && !allowBackground) return;
      void this.executeImmediatePlay(type, targetVolume);
      return;
    }

    if (!this.canPlayNow()) {
      this.dropQueuedSounds();
      if (this.audioContext?.state !== 'running') this.armGestureUnlock();
      return;
    }

    if (this.playQueue.length >= this.MAX_QUEUE_SIZE) this.playQueue.shift();
    this.playQueue.push({ type, volume: targetVolume, enqueuedAt: Date.now() });
    void this.processQueue();
  }

  private async executeImmediatePlay(type: PosSoundType, customVolume?: number): Promise<boolean> {
    const context = this.getAudioContext();
    if (context && context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        // Resume may fail if strictly blocked by browser policy without prior gesture
      }
    }

    if (type === 'PAYMENT_SUCCESS') {
      return this.executePaymentSuccessPlay(customVolume);
    }

    const volume = this.clampVolume(customVolume);
    if (volume === 0) return false;

    // Try 1: Decoded AudioBuffer in Web Audio
    if (context && context.state === 'running') {
      try {
        const buffer =
          this.audioBuffers.get(type) ??
          (type !== 'NOTIFICATION_CHIME'
            ? await this.preload(type as Exclude<PosSoundType, 'NOTIFICATION_CHIME'>)
            : null);
        if (buffer) {
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = buffer;
          gain.gain.setValueAtTime(volume, context.currentTime);
          source.connect(gain);
          gain.connect(context.destination);
          source.start(0);
          this.isUnlocked = true;
          this.lastPlayTime = Date.now();
          return true;
        }
      } catch {
        // Fall back below
      }
    }

    // Try 2: Synthesized chime
    if (type === 'NOTIFICATION_CHIME' && context && context.state === 'running') {
      if (this.playSynthesizedChime(volume, Date.now())) {
        this.lastPlayTime = Date.now();
        return true;
      }
    }

    // Try 3: HTML5 Audio fallback for audio files
    const soundFile = SOUND_FILES[type as keyof typeof SOUND_FILES];
    if (typeof Audio !== 'undefined' && soundFile) {
      try {
        const audio = new Audio(soundFile);
        audio.volume = Math.min(1, volume);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              this.isUnlocked = true;
            })
            .catch(() => {});
        }
        this.lastPlayTime = Date.now();
        return true;
      } catch {
        // Fallback below
      }
    }

    const item: QueueItem = {
      type,
      volume: customVolume,
      enqueuedAt: Date.now(),
    };
    return this.executePlay(item);
  }

  private async executePaymentSuccessPlay(customVolume = 1.0): Promise<boolean> {
    const volume = this.clampVolume(customVolume);
    if (volume === 0) return false;

    const context = this.getAudioContext();
    if (context && context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        // Fallback attempted below
      }
    }

    // Tăng âm lượng hơn 1 tí khi thanh toán thành công (hệ số 1.35x giúp âm thanh to, rõ ràng hơn)
    const boostedVolume = volume * 1.35;

    // Try 1: Decoded AudioBuffer in Web Audio (instant playback)
    if (context && context.state === 'running') {
      try {
        const buffer =
          this.audioBuffers.get('PAYMENT_SUCCESS') ?? (await this.preload('PAYMENT_SUCCESS'));
        if (buffer) {
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = buffer;
          gain.gain.setValueAtTime(boostedVolume, context.currentTime);
          source.connect(gain);
          gain.connect(context.destination);
          source.start(0);
          this.isUnlocked = true;
          this.lastPlayTime = Date.now();
          return true;
        }
      } catch {
        // Fall back to synthesized payment fanfare below
      }
    }

    // Try 2: Instant Procedural Web Audio Synthesis (0ms network-free fallback)
    if (context && context.state === 'running') {
      if (this.playSynthesizedPaymentFanfare(boostedVolume)) {
        this.lastPlayTime = Date.now();
        return true;
      }
    }

    // Try 3: HTML5 Audio fallback (e.g. if Web Audio context is not allowed or closed)
    if (typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(SOUND_FILES.PAYMENT_SUCCESS);
        audio.volume = Math.min(1, volume);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              this.isUnlocked = true;
            })
            .catch(() => {});
        }
        this.lastPlayTime = Date.now();
        return true;
      } catch {
        // Ignore fallback error
      }
    }

    return false;
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

  /**
   * Order saved sound: Two-tone ascending warm confirmation chime (E5 -> B5).
   * Soft, reassuring, confirms the order is saved without being loud or intrusive.
   * Only triggers on mobile phones.
   */
  playOrderSave(customVolume = 0.22): boolean {
    if (typeof window === 'undefined' || this.isMuted || !isMobilePhoneDevice()) return false;
    const context = this.getAudioContext();
    if (!context || context.state === 'closed') return false;
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    try {
      const now = context.currentTime;
      const volume = this.clampVolume(customVolume);
      if (volume === 0) return false;

      // Note 1: 659.25Hz (E5)
      const osc1 = context.createOscillator();
      const gain1 = context.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.16 * volume, now + 0.003);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc1.connect(gain1);
      gain1.connect(context.destination);
      osc1.start(now);
      osc1.stop(now + 0.08);

      // Note 2: 987.77Hz (B5) at +45ms
      const note2Start = now + 0.045;
      const osc2 = context.createOscillator();
      const gain2 = context.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, note2Start);
      gain2.gain.setValueAtTime(0.001, note2Start);
      gain2.gain.linearRampToValueAtTime(0.2 * volume, note2Start + 0.003);
      gain2.gain.exponentialRampToValueAtTime(0.001, note2Start + 0.12);
      osc2.connect(gain2);
      gain2.connect(context.destination);
      osc2.start(note2Start);
      osc2.stop(note2Start + 0.12);

      // Light sparkling harmonic overtone on Note 2 (1975Hz)
      const oscSparkle = context.createOscillator();
      const gainSparkle = context.createGain();
      oscSparkle.type = 'triangle';
      oscSparkle.frequency.setValueAtTime(1975.5, note2Start);
      gainSparkle.gain.setValueAtTime(0.001, note2Start);
      gainSparkle.gain.linearRampToValueAtTime(0.04 * volume, note2Start + 0.002);
      gainSparkle.gain.exponentialRampToValueAtTime(0.001, note2Start + 0.06);
      oscSparkle.connect(gainSparkle);
      gainSparkle.connect(context.destination);
      oscSparkle.start(note2Start);
      oscSparkle.stop(note2Start + 0.06);

      this.isUnlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cancel order sound: Subtle, gentle descending two-tone chime (F#5 -> D5).
   * Noticeable and distinct, but soft, pleasant, and non-jarring.
   * Only triggers on mobile phones.
   */
  playCancelOrder(customVolume = 0.22): boolean {
    if (typeof window === 'undefined' || this.isMuted || !isMobilePhoneDevice()) return false;
    const context = this.getAudioContext();
    if (!context || context.state === 'closed') return false;
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    try {
      const now = context.currentTime;
      const volume = this.clampVolume(customVolume);
      if (volume === 0) return false;

      // Note 1: 739.99Hz (F#5)
      const osc1 = context.createOscillator();
      const gain1 = context.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(739.99, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.18 * volume, now + 0.002);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc1.connect(gain1);
      gain1.connect(context.destination);
      osc1.start(now);
      osc1.stop(now + 0.08);

      // Note 2: 587.33Hz (D5 - descending warm resolution) at +45ms
      const note2Start = now + 0.045;
      const osc2 = context.createOscillator();
      const gain2 = context.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(587.33, note2Start);
      gain2.gain.setValueAtTime(0.001, note2Start);
      gain2.gain.linearRampToValueAtTime(0.16 * volume, note2Start + 0.002);
      gain2.gain.exponentialRampToValueAtTime(0.001, note2Start + 0.1);
      osc2.connect(gain2);
      gain2.connect(context.destination);
      osc2.start(note2Start);
      osc2.stop(note2Start + 0.1);

      this.isUnlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signature Pro POS payment success fanfare:
   * Layered metallic coin clink ('cha-ching') + victorious ascending bell chime (G5 -> C6 -> E6 -> G6 -> C7).
   * Punchy, catchy, unmistakable payment confirmation for counters and push notifications.
   */
  playPaymentSuccess(customVolume = 1.0): boolean {
    if (typeof window === 'undefined' || this.isMuted) return false;
    void this.executePaymentSuccessPlay(customVolume);
    return true;
  }

  playSynthesizedPaymentFanfare(customVolume = 1.0): boolean {
    if (typeof window === 'undefined' || this.isMuted) return false;
    const context = this.getAudioContext();
    if (!context || context.state === 'closed') return false;
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    try {
      const now = context.currentTime;
      const baseVol = this.clampVolume(customVolume);
      if (baseVol === 0) return false;
      const volume = Math.max(0, customVolume ?? this.DEFAULT_VOLUME);

      // 1. Double Coin Clink (metallic inharmonic cluster: 3350Hz & 3820Hz)
      const playCoinClink = (startTime: number, baseFreq: number, clinkVol: number) => {
        const freqs = [baseFreq, baseFreq * Math.SQRT2, baseFreq * 2.312];
        for (const f of freqs) {
          const osc = context.createOscillator();
          const gain = context.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, startTime);
          gain.gain.setValueAtTime(0.001, startTime);
          gain.gain.linearRampToValueAtTime(clinkVol * volume, startTime + 0.001);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);
          osc.connect(gain);
          gain.connect(context.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.07);
        }
      };

      playCoinClink(now, 3350, 0.25);
      playCoinClink(now + 0.038, 3820, 0.28);

      // 2. Ascending Triumphant Fanfare (G5 -> C6 -> E6 -> G6 -> C7)
      const notes = [
        { freq: 783.99, time: now + 0.07, dur: 0.35, vol: 0.35 },
        { freq: 1046.5, time: now + 0.145, dur: 0.4, vol: 0.42 },
        { freq: 1318.51, time: now + 0.22, dur: 0.48, vol: 0.5 },
        { freq: 1567.98, time: now + 0.295, dur: 0.55, vol: 0.6 },
        { freq: 2093.0, time: now + 0.37, dur: 0.85, vol: 0.75 }, // C7 peak
      ];

      for (const n of notes) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, n.time);
        gain.gain.setValueAtTime(0.001, n.time);
        gain.gain.linearRampToValueAtTime(n.vol * volume, n.time + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, n.time + n.dur);
        osc.connect(gain);
        gain.connect(context.destination);
        osc.start(n.time);
        osc.stop(n.time + n.dur);
      }

      // Sparkle chime overtone on C7 (4186 Hz)
      const topNoteTime = now + 0.37;
      const oscSparkle = context.createOscillator();
      const gainSparkle = context.createGain();
      oscSparkle.type = 'triangle';
      oscSparkle.frequency.setValueAtTime(4186.01, topNoteTime);
      gainSparkle.gain.setValueAtTime(0.001, topNoteTime);
      gainSparkle.gain.linearRampToValueAtTime(0.18 * volume, topNoteTime + 0.002);
      gainSparkle.gain.exponentialRampToValueAtTime(0.001, topNoteTime + 0.5);
      oscSparkle.connect(gainSparkle);
      gainSparkle.connect(context.destination);
      oscSparkle.start(topNoteTime);
      oscSparkle.stop(topNoteTime + 0.5);

      this.isUnlocked = true;
      return true;
    } catch {
      return false;
    }
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

export function playPosSound(type: PosSoundType, options?: PlaySoundOptions): void {
  posSound.play(type, options);
}

export function playOrderSaveSound(volume?: number): void {
  posSound.playOrderSave(volume);
}

export function playCancelOrderSound(volume?: number): void {
  posSound.playCancelOrder(volume);
}

export function playPaymentSuccessSound(optionsOrVolume?: number | PlaySoundOptions): void {
  const options =
    typeof optionsOrVolume === 'number' ? { volume: optionsOrVolume } : optionsOrVolume;
  const playOpts: PlaySoundOptions = {
    volume: options?.volume ?? 1.0,
    immediate: true,
    allowBackground: options?.allowBackground ?? true,
  };
  if (options?.dedupeKey !== undefined) {
    playOpts.dedupeKey = options.dedupeKey;
  }
  if (options?.force !== undefined) {
    playOpts.force = options.force;
  }
  posSound.play('PAYMENT_SUCCESS', playOpts);
}

export function warmPosSounds(types: Array<Exclude<PosSoundType, 'NOTIFICATION_CHIME'>>): void {
  posSound.warm(types);
}

export function playPushNotificationSound(payload?: {
  kind?: string | null;
  soundType?: string | null;
  orderId?: string | null;
  tag?: string | null;
}): void {
  if (!payload) return;
  const soundType = payload.soundType;
  const kind = payload.kind;
  const dedupeKey = `push:${payload.orderId ?? payload.tag ?? kind ?? soundType ?? Date.now()}`;

  if (soundType === 'PAYMENT_SUCCESS' || kind === 'ORDER_PAID') {
    playPaymentSuccessSound({
      dedupeKey,
      volume: 1.0,
      allowBackground: true,
      force: true,
    });
  } else if (soundType === 'NEW_QR_ORDER' || kind === 'QR_ORDER') {
    posSound.play('NEW_QR_ORDER', {
      dedupeKey,
      volume: 1.0,
      immediate: true,
      allowBackground: true,
      force: true,
    });
  } else if (soundType === 'CHECKOUT_REQUEST' || kind === 'CHECKOUT_REQUEST') {
    posSound.play('CHECKOUT_REQUEST', {
      dedupeKey,
      volume: 1.0,
      immediate: true,
      allowBackground: true,
      force: true,
    });
  } else if (soundType === 'TABLE_OPEN_REQUEST' || kind === 'TABLE_OPEN_REQUEST') {
    posSound.play('TABLE_OPEN_REQUEST', {
      dedupeKey,
      volume: 1.0,
      immediate: true,
      allowBackground: true,
      force: true,
    });
  } else if (soundType === 'CALL_STAFF' || kind === 'CALL_STAFF') {
    posSound.play('CALL_STAFF', {
      dedupeKey,
      volume: 1.0,
      immediate: true,
      allowBackground: true,
      force: true,
    });
  } else {
    posSound.play('NOTIFICATION_CHIME', {
      dedupeKey,
      volume: 1.0,
      immediate: true,
      allowBackground: true,
      force: true,
    });
  }
}

export function registerPushNotificationSoundListener(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  warmPosSounds([
    'PAYMENT_SUCCESS',
    'NEW_QR_ORDER',
    'CALL_STAFF',
    'CHECKOUT_REQUEST',
    'TABLE_OPEN_REQUEST',
  ]);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        reg?.update().catch(() => {});
      })
      .catch(() => {});
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'PUSH_NOTIFICATION_RECEIVED') {
      playPushNotificationSound(event.data.payload);
    }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleMessage);
  }

  let broadcastChannel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel('propos-notifications');
      broadcastChannel.addEventListener('message', handleMessage);
    }
  } catch {
    // Non-blocking
  }

  return () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    }
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleMessage);
      broadcastChannel.close();
    }
  };
}
