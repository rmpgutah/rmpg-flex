// Tests the gates around the login chime — silent mode and debounce.
// The sign-on is SAMPLE-ONLY (login.wav via soundAssets); an asset miss
// is intentional silence with no oscillator fallback.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const playSoundAsset = vi.fn();
vi.mock('../soundAssets', () => ({
  playSoundAsset: (...args: unknown[]) => playSoundAsset(...args),
}));

import { playStartupSound } from '../startupSound';

describe('playStartupSound', () => {
  beforeEach(() => {
    localStorage.clear();
    playSoundAsset.mockReset();
    playSoundAsset.mockReturnValue(true);
    vi.useRealTimers();
    delete (window as any).AudioContext;
  });

  it('plays the sampled sign-on in audible mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000); // past any debounce from other tests
    playStartupSound();
    expect(playSoundAsset).toHaveBeenCalledWith('login');
  });

  it('builds no synth fallback when the asset is not ready', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const ctor = vi.fn();
    (window as any).AudioContext = ctor;
    playSoundAsset.mockReturnValue(false);
    playStartupSound();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('debounces a second call within 3s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000_000);
    playStartupSound();
    const after = playSoundAsset.mock.calls.length;
    playStartupSound();
    expect(playSoundAsset.mock.calls.length).toBe(after);
  });

  it('is silent in silent audio mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(13_000_000);
    localStorage.setItem('rmpg_unit_audio_mode', 'silent');
    playStartupSound();
    expect(playSoundAsset).not.toHaveBeenCalled();
  });
});
