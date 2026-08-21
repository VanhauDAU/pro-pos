export const POS_SOUNDS = {
  NEW_QR_ORDER: '/sound/sound_goimonmoi.ogg',
  CHECKOUT_REQUEST: '/sound/sound_yeucauthanhtoan.ogg',
} as const;

export type PosSoundType = keyof typeof POS_SOUNDS;

class PosSoundEngine {
  private audioContext: AudioContext | null = null;
  private readonly bufferCache = new Map<PosSoundType, AudioBuffer>();
  private readonly audioElements = new Map<PosSoundType, HTMLAudioElement>();
  private isUnlocked = false;
  private isLoadingBuffers = false;

  constructor() {
    if (typeof window === 'undefined') return;
    this.initAudioElements();
    this.registerAutoUnlock();
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }
    return this.audioContext;
  }

  private initAudioElements() {
    for (const [key, url] of Object.entries(POS_SOUNDS) as Array<[PosSoundType, string]>) {
      try {
        const audio = new Audio(url);
        audio.preload = 'auto';
        this.audioElements.set(key, audio);
      } catch {
        // Ignore initialization error
      }
    }
  }

  private registerAutoUnlock() {
    const unlockEvents = ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'];
    const unlockHandler = () => {
      this.unlock();
      for (const eventName of unlockEvents) {
        window.removeEventListener(eventName, unlockHandler, true);
      }
    };
    for (const eventName of unlockEvents) {
      window.addEventListener(eventName, unlockHandler, {
        capture: true,
        passive: true,
        once: true,
      });
    }
  }

  /**
   * Unlock AudioContext and preload sound buffers upon first user gesture.
   */
  unlock() {
    if (this.isUnlocked) return;
    this.isUnlocked = true;

    const ctx = this.getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      // Play a short silent buffer to unlock iOS Safari Web Audio stack
      try {
        const silentBuffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {
        // Ignore
      }
    }

    // Preload audio elements
    for (const audio of this.audioElements.values()) {
      try {
        audio.load();
      } catch {
        // Ignore
      }
    }

    // Pre-decode audio buffers into memory for zero-latency instant playback
    void this.loadBuffers();
  }

  private async loadBuffers() {
    if (this.isLoadingBuffers) return;
    this.isLoadingBuffers = true;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    await Promise.all(
      (Object.entries(POS_SOUNDS) as Array<[PosSoundType, string]>).map(async ([key, url]) => {
        if (this.bufferCache.has(key)) return;
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          this.bufferCache.set(key, audioBuffer);
        } catch {
          // Decoding failure fallback to HTMLAudioElement
        }
      }),
    );
  }

  /**
   * Play sound with 0ms latency using pre-decoded AudioBuffer,
   * falling back to HTMLAudioElement and triggering haptic vibration.
   */
  play(type: PosSoundType) {
    // 1. Trigger haptic vibration on mobile devices
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (type === 'NEW_QR_ORDER') {
          navigator.vibrate([200, 100, 200]);
        } else {
          navigator.vibrate([400, 150, 400]);
        }
      } catch {
        // Ignore vibration error
      }
    }

    // 2. Primary Engine: Web Audio API (Instant, non-blocking, multi-channel)
    const ctx = this.getAudioContext();
    const buffer = this.bufferCache.get(type);

    if (ctx && buffer) {
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        return;
      } catch {
        // Fall back to HTMLAudioElement below
      }
    }

    // 3. Fallback Engine: HTMLAudioElement
    const audio = this.audioElements.get(type);
    if (audio) {
      try {
        audio.currentTime = 0;
        const promise = audio.play();
        if (promise !== undefined) {
          promise.catch(() => {
            // Autoplay policy prevented playback, try to unlock next touch
            this.isUnlocked = false;
          });
        }
      } catch {
        // Ignore HTML5 audio error
      }
    }

    // Attempt to load buffers if not loaded yet
    if (!this.bufferCache.has(type)) {
      void this.loadBuffers();
    }
  }
}

const engine = new PosSoundEngine();

export function playPosSound(type: PosSoundType): void {
  engine.play(type);
}

export function unlockPosAudio(): void {
  engine.unlock();
}
