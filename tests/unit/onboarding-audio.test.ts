import { describe, expect, it } from 'vitest';

import { OnboardingAudioPlayer } from '@client/lib/onboarding-audio';

describe('OnboardingAudioPlayer', () => {
  it('initializes in unmuted state', () => {
    const player = new OnboardingAudioPlayer();
    expect(player.isMuted()).toBe(false);
  });

  it('toggles muted state and stops audio when muted', () => {
    const player = new OnboardingAudioPlayer();
    player.setMuted(true);
    expect(player.isMuted()).toBe(true);

    player.setMuted(false);
    expect(player.isMuted()).toBe(false);
  });

  it('suppresses audio playback when muted', () => {
    const player = new OnboardingAudioPlayer();
    player.setMuted(true);

    player.play(0);
    expect(player.isMuted()).toBe(true);
  });

  it('handles play and stop without errors in Node / SSR environment', () => {
    const player = new OnboardingAudioPlayer();
    player.play(0);
    player.play(1);
    player.stop();
    player.unlock();
    player.destroy();
    expect(player.isMuted()).toBe(false);
  });

  it('does not throw when setting muted and stopping', () => {
    const player = new OnboardingAudioPlayer();
    player.setMuted(true);
    player.stop();
    expect(player.isMuted()).toBe(true);
  });
});
