const FIRST_TRACK = 0;
const LAST_TRACK = 13;

function getTrackUrls(track: number): string[] {
  const pad = String(track).padStart(2, '0');
  return [
    track === 0 ? `/sound/sound_${pad}.mp3` : `/sound/sound_${pad}.MP3`,
    `/sound/sound_${pad}.mp3`,
    `/sound/sound_${pad}.MP3`,
    `/api/v1/pos/onboarding/audio/${pad}`,
  ];
}

export class OnboardingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private readonly bufferCache = new Map<number, AudioBuffer>();
  private readonly audioElements = new Map<number, HTMLAudioElement>();
  private isUnlocked = false;
  private isLoadingBuffers = false;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private currentTrack: number | null = null;
  private muted = false;

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
        try {
          this.audioContext = new AudioCtx();
        } catch {
          // Ignored
        }
      }
    }
    return this.audioContext;
  }

  private initAudioElements() {
    for (let track = FIRST_TRACK; track <= LAST_TRACK; track++) {
      try {
        const url = getTrackUrls(track)[0] ?? `/sound/sound_${String(track).padStart(2, '0')}.MP3`;
        const audio = new Audio(url);
        audio.preload = 'auto';
        this.audioElements.set(track, audio);
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

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.stop();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  unlock() {
    if (typeof window === 'undefined') return;
    this.isUnlocked = true;

    const ctx = this.getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      try {
        const silentBuffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {
        // Ignored
      }
    }

    for (const audio of this.audioElements.values()) {
      try {
        audio.load();
      } catch {
        // Ignored
      }
    }

    void this.preload();
  }

  async preload(): Promise<void> {
    if (typeof window === 'undefined' || this.isLoadingBuffers) return;
    this.isLoadingBuffers = true;
    const ctx = this.getAudioContext();

    await Promise.all(
      Array.from({ length: LAST_TRACK - FIRST_TRACK + 1 }, async (_, offset) => {
        const track = FIRST_TRACK + offset;
        if (this.bufferCache.has(track)) return;
        await this.loadTrackBuffer(track, ctx);
      }),
    );
    this.isLoadingBuffers = false;
  }

  private async loadTrackBuffer(track: number, ctx: AudioContext | null): Promise<void> {
    const urls = getTrackUrls(track);
    for (const url of urls) {
      try {
        const response = await fetch(url).catch(() => null);
        if (!response || !response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        if (ctx) {
          try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            this.bufferCache.set(track, audioBuffer);
            return;
          } catch {
            // Buffer decoding failed, continue to next URL
          }
        }
      } catch {
        // Continue to next URL
      }
    }
  }

  play(track: number) {
    if (typeof window === 'undefined') return;
    if (track < FIRST_TRACK || track > LAST_TRACK) return;

    this.stop();
    this.currentTrack = track;
    if (this.muted) return;

    const ctx = this.getAudioContext();
    const buffer = this.bufferCache.get(track);

    if (ctx && buffer) {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.addEventListener(
          'ended',
          () => {
            if (this.activeSource === source) {
              this.activeSource = null;
            }
          },
          { once: true },
        );
        this.activeSource = source;
        source.start(0);
        return;
      } catch {
        // Fall back to HTMLAudioElement
      }
    }

    const audio = this.audioElements.get(track);
    if (audio) {
      try {
        this.activeAudio = audio;
        audio.currentTime = 0;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            this.isUnlocked = false;
          });
        }
      } catch {
        // Ignored
      }
    }

    if (!this.bufferCache.has(track)) {
      void this.loadTrackBuffer(track, ctx);
    }
  }

  stop() {
    this.currentTrack = null;
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // Ignored
      }
      try {
        this.activeSource.disconnect();
      } catch {
        // Ignored
      }
      this.activeSource = null;
    }
    if (this.activeAudio) {
      try {
        this.activeAudio.pause();
        this.activeAudio.currentTime = 0;
      } catch {
        // Ignored
      }
      this.activeAudio = null;
    }
    for (const audio of this.audioElements.values()) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // Ignored
      }
    }
  }

  destroy() {
    this.stop();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.bufferCache.clear();
    this.audioElements.clear();
    this.isUnlocked = false;
    this.isLoadingBuffers = false;
  }
}

export const onboardingAudioPlayer = new OnboardingAudioPlayer();
