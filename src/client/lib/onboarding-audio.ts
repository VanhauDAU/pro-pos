const FIRST_TRACK = 0;
const LAST_TRACK = 13;

function trackUrl(track: number) {
  return `/api/v1/pos/onboarding/audio/${String(track).padStart(2, '0')}`;
}

export class OnboardingAudioPlayer {
  private context: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private fallbackAudio = new Map<number, HTMLAudioElement>();
  private objectUrls = new Map<number, string>();
  private source: AudioBufferSourceNode | null = null;
  private preloadPromise: Promise<void> | null = null;
  private requestedTrack: number | null = null;

  preload() {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = this.loadAll();
    return this.preloadPromise;
  }

  private async loadAll() {
    if (typeof window === 'undefined') return;
    const AudioContextConstructor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor) this.context = new AudioContextConstructor();

    await Promise.all(
      Array.from({ length: LAST_TRACK - FIRST_TRACK + 1 }, async (_, offset) => {
        const track = FIRST_TRACK + offset;
        const url = trackUrl(track);
        try {
          const response = await fetch(url, { credentials: 'include' });
          if (!response.ok) throw new Error(`ONBOARDING_AUDIO_${response.status}`);
          const encoded = await response.arrayBuffer();
          const objectUrl = URL.createObjectURL(new Blob([encoded], { type: 'audio/mpeg' }));
          const audio = new Audio(objectUrl);
          audio.preload = 'auto';
          audio.load();
          this.objectUrls.set(track, objectUrl);
          this.fallbackAudio.set(track, audio);
          if (this.context) {
            this.buffers.set(track, await this.context.decodeAudioData(encoded.slice(0)));
            return;
          }
        } catch {
          const audio = new Audio(url);
          audio.preload = 'auto';
          audio.load();
          this.fallbackAudio.set(track, audio);
        }
      }),
    );
  }

  async unlock() {
    if (this.context?.state === 'suspended') {
      await this.context.resume().catch(() => undefined);
    }
  }

  async play(track: number) {
    if (track < FIRST_TRACK || track > LAST_TRACK) return;
    this.requestedTrack = track;
    await this.preload();
    if (this.requestedTrack !== track) return;
    this.stopCurrent();

    const buffer = this.buffers.get(track);
    if (this.context && buffer) {
      await this.unlock();
      if (this.context.state === 'running') {
        if (this.requestedTrack !== track) return;
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.context.destination);
        source.addEventListener(
          'ended',
          () => {
            if (this.source === source) this.source = null;
          },
          { once: true },
        );
        this.source = source;
        source.start(0);
        return;
      }
    }

    const audio = this.fallbackAudio.get(track) ?? new Audio(trackUrl(track));
    this.fallbackAudio.set(track, audio);
    audio.currentTime = 0;
    await audio.play().catch(() => undefined);
  }

  stop() {
    this.requestedTrack = null;
    this.stopCurrent();
  }

  destroy() {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
    this.fallbackAudio.clear();
    for (const objectUrl of this.objectUrls.values()) URL.revokeObjectURL(objectUrl);
    this.objectUrls.clear();
    this.preloadPromise = null;
  }

  private stopCurrent() {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // The source may already have ended.
      }
      this.source.disconnect();
      this.source = null;
    }
    for (const audio of this.fallbackAudio.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
}

export const onboardingAudioPlayer = new OnboardingAudioPlayer();
