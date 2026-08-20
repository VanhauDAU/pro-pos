const DEFAULT_VOLUME = 0.25;
let audioInstance: HTMLAudioElement | null = null;

/**
 * Plays the click sound effect when interacting with POS items and action buttons.
 * Uses a gentle volume (~25%) for comfortable feedback during fast cashier operations.
 */
export function playClickSound(volume = DEFAULT_VOLUME) {
  try {
    if (typeof window === 'undefined') return;
    if (!audioInstance) {
      audioInstance = new Audio('/sounds/soundeffect_click.opus');
      audioInstance.preload = 'auto';
      audioInstance.volume = volume;
    }
    audioInstance.volume = volume;

    if (audioInstance.paused) {
      audioInstance.currentTime = 0;
      void audioInstance.play().catch(() => {});
    } else {
      const clone = audioInstance.cloneNode() as HTMLAudioElement;
      clone.volume = volume;
      void clone.play().catch(() => {});
    }
  } catch {
    // Safely ignore audio errors if blocked by browser policy
  }
}
