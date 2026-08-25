/**
 * Centralized POS Sound Service
 *
 * Provides optimized, resilient, preloaded audio notifications for POS.
 * - Preloads and reuses HTMLAudioElement instances (no new Audio() per event).
 * - Handles autoplay restrictions across Chrome, Safari/iOS, Android and PWA.
 * - Deduplicates events by event/request ID to prevent duplicate alerts.
 * - Ignores old/replayed events upon realtime reconnection.
 * - Smoothly throttles and queues audio plays to avoid overlapping cacophony.
 * - Safely catches all play() promise rejections to prevent unhandled errors.
 * - Falls back to synthesized Web Audio API chimes if file loading fails.
 */

export type PosSoundType =
  | 'NEW_QR_ORDER'
  | 'PAYMENT_SUCCESS'
  | 'TABLE_OPEN_REQUEST'
  | 'CALL_STAFF'
  | 'NOTIFICATION_CHIME'
  | 'GUEST_ORDER_SENT'
  | 'GUEST_CHECKOUT_REQUEST_SENT'
  | 'GUEST_QR_OPEN_REQUESTED';

const SOUND_FILES: Record<Exclude<PosSoundType, 'NOTIFICATION_CHIME'>, string> = {
  NEW_QR_ORDER: '/sounds/sound_goimonmoi.ogg',
  PAYMENT_SUCCESS: '/sounds/sound_thanhtoanthanhcong.ogg',
  TABLE_OPEN_REQUEST: '/sounds/sound_yeuccaumoban.ogg',
  CALL_STAFF: '/sounds/sound_yeuccaumoban.ogg',
  GUEST_ORDER_SENT: '/sounds/guest_order_sent.ogg',
  GUEST_CHECKOUT_REQUEST_SENT: '/sounds/guest_checkout_request_sent.ogg',
  GUEST_QR_OPEN_REQUESTED: '/sounds/guest_qr_open_requested.ogg',
};

interface QueueItem {
  type: PosSoundType;
  volume: number | undefined;
}

class SoundManager {
  private static instance: SoundManager | null = null;

  private audioElements = new Map<string, HTMLAudioElement>();
  private loadedElements = new Set<string>();
  private audioContext: AudioContext | null = null;
  private isUnlocked = false;
  private unlockPromise: Promise<boolean> | null = null;

  // Deduplication cache with TTL
  private seenKeys = new Map<string, number>();
  private readonly DEDUPE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Playback queue & throttling
  private playQueue: QueueItem[] = [];
  private isPlaying = false;
  private lastPlayTime = 0;
  private readonly MIN_INTERVAL_MS = 350;
  private readonly DEFAULT_VOLUME = 0.5;

  // Mute setting
  private isMuted = false;

  private constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.isMuted = localStorage.getItem('propos:sound:muted') === 'true';
      } catch {
        this.isMuted = false;
      }
      this.initAutoplayUnlock();
      this.preloadAll();
    }
  }

  static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
    try {
      localStorage.setItem('propos:sound:muted', String(muted));
    } catch {
      // Ignore storage errors
    }
  }

  private preloadAll() {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    for (const [key, path] of Object.entries(SOUND_FILES)) {
      if (!this.audioElements.has(key)) {
        try {
          const audio = new Audio();
          audio.preload = 'auto';
          audio.addEventListener(
            'canplaythrough',
            () => {
              this.loadedElements.add(key);
            },
            { once: true },
          );
          audio.addEventListener(
            'error',
            () => {
              // Mark as not loaded, will use chime fallback
            },
            { once: true },
          );
          audio.src = path;
          audio.load();
          this.audioElements.set(key, audio);
        } catch {
          // Graceful fallback to Web Audio
        }
      }
    }
  }

  private initAutoplayUnlock() {
    if (typeof window === 'undefined') return;

    const unlockHandler = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlockHandler, true);
      window.removeEventListener('touchstart', unlockHandler, true);
      window.removeEventListener('keydown', unlockHandler, true);
      window.removeEventListener('click', unlockHandler, true);
    };

    window.addEventListener('pointerdown', unlockHandler, {
      once: true,
      passive: true,
      capture: true,
    });
    window.addEventListener('touchstart', unlockHandler, {
      once: true,
      passive: true,
      capture: true,
    });
    window.addEventListener('keydown', unlockHandler, { once: true, passive: true, capture: true });
    window.addEventListener('click', unlockHandler, { once: true, passive: true, capture: true });
  }

  async unlock(): Promise<boolean> {
    if (this.isUnlocked) return true;
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = (async () => {
      try {
        // 1. Unlock Web Audio Context
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          if (!this.audioContext) {
            this.audioContext = new AudioCtx();
          }
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
          }
        }

        // 2. Warm up preloaded Audio instances with silent play
        const warmups: Promise<void>[] = [];
        for (const audio of this.audioElements.values()) {
          const originalVolume = audio.volume;
          audio.volume = 0;
          const promise = audio
            .play()
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.volume = originalVolume;
            })
            .catch(() => {
              audio.volume = originalVolume;
            });
          warmups.push(promise);
        }
        await Promise.allSettled(warmups);

        this.isUnlocked = true;
        return true;
      } catch {
        return false;
      } finally {
        this.unlockPromise = null;
      }
    })();

    return this.unlockPromise;
  }

  private cleanOldDedupeKeys() {
    const now = Date.now();
    for (const [key, timestamp] of this.seenKeys.entries()) {
      if (now - timestamp > this.DEDUPE_TTL_MS) {
        this.seenKeys.delete(key);
      }
    }
  }

  /**
   * Play a sound notification with optional deduplication and priority.
   */
  play(
    type: PosSoundType,
    options?: {
      dedupeKey?: string;
      volume?: number;
      force?: boolean;
    },
  ) {
    if (typeof window === 'undefined' || (this.isMuted && !options?.force)) return;

    // Deduplicate by ID/Key
    if (options?.dedupeKey) {
      this.cleanOldDedupeKeys();
      if (this.seenKeys.has(options.dedupeKey)) {
        return; // Already played for this event/request
      }
      this.seenKeys.set(options.dedupeKey, Date.now());
    }

    // Enqueue
    if (this.playQueue.length >= 4) {
      // Limit queue to prevent lagging sound backlog
      this.playQueue.shift();
    }
    const vol = options?.volume;
    this.playQueue.push({ type, volume: vol });
    void this.processQueue();
  }

  private async processQueue() {
    if (this.isPlaying || this.playQueue.length === 0) return;

    this.isPlaying = true;
    const item = this.playQueue.shift()!;

    try {
      // Ensure autoplay is unlocked before trying to play
      if (!this.isUnlocked) {
        await this.unlock();
      }

      const now = Date.now();
      const timeSinceLast = now - this.lastPlayTime;
      if (timeSinceLast < this.MIN_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, this.MIN_INTERVAL_MS - timeSinceLast));
      }

      await this.executePlay(item.type, item.volume);
      this.lastPlayTime = Date.now();
    } catch {
      // Never throw from audio processing
    } finally {
      this.isPlaying = false;
      if (this.playQueue.length > 0) {
        window.setTimeout(() => void this.processQueue(), 50);
      }
    }
  }

  private async executePlay(type: PosSoundType, customVolume?: number): Promise<void> {
    if (type === 'NOTIFICATION_CHIME') {
      await this.playSynthesizedChime();
      return;
    }

    const audio = this.audioElements.get(type);
    if (!audio || !this.loadedElements.has(type)) {
      // Audio file not loaded, fallback to synthesized chime
      await this.playSynthesizedChime();
      return;
    }

    try {
      audio.currentTime = 0;
      audio.volume = Math.max(0, Math.min(1, customVolume ?? this.DEFAULT_VOLUME));
      await audio.play();
    } catch {
      // If browser rejected play (autoplay blocked), try synthesized chime
      await this.playSynthesizedChime();
    }
  }

  private async playSynthesizedChime() {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      gain1.gain.setValueAtTime(0.06, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.25);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.08); // A5
      gain2.gain.setValueAtTime(0.08, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.35);
    } catch {
      // Audio completely disabled / restricted on this environment
    }
  }
}

export const posSound = SoundManager.getInstance();

export function playPosSound(
  type: PosSoundType,
  options?: {
    dedupeKey?: string;
    volume?: number;
    force?: boolean;
  },
) {
  posSound.play(type, options);
}
