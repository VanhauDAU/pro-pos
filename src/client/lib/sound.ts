export const POS_SOUNDS = {
  NEW_QR_ORDER: '/sound/sound_goimonmoi.ogg',
  CHECKOUT_REQUEST: '/sound/sound_yeucauthanhtoan.ogg',
} as const;

export type PosSoundType = keyof typeof POS_SOUNDS;

const audioCache: Partial<Record<PosSoundType, HTMLAudioElement>> = {};

function getAudioElement(type: PosSoundType): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!audioCache[type]) {
    try {
      const audio = new Audio(POS_SOUNDS[type]);
      audio.preload = 'auto';
      audioCache[type] = audio;
    } catch {
      return null;
    }
  }
  return audioCache[type] ?? null;
}

/**
 * Play a POS notification sound.
 * Handled gracefully if browser autoplay policy restricts un-interacted playback.
 */
export function playPosSound(type: PosSoundType): void {
  try {
    const audio = getAudioElement(type);
    if (!audio) return;
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay policy prevented playback, ignore silently.
      });
    }
  } catch {
    // Ignore any audio exceptions
  }
}
