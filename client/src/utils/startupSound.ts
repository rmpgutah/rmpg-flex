// ============================================================
// RMPG Flex — Startup Sound (Spillman Flex / Motorola console)
// A terminal-style "sign-on acknowledge" played once after a
// successful login/2FA. SAMPLE-ONLY: plays the curated login.wav
// asset via soundAssets.ts; if the asset isn't decoded yet the
// sign-on is simply silent (no oscillator fallback — the synth
// version was harsher than the tuned sample and is intentionally
// gone). Respects the per-unit silent-dispatch audio mode.
// ============================================================
import { getLocalAudioMode } from './audioMode';
import { playSoundAsset } from './soundAssets';

let lastPlayed = 0;

/**
 * Play the sign-on tone. Safe to call unconditionally:
 * - no-ops in silent/vibrate audio mode
 * - no-ops if the asset isn't ready or WebAudio is unavailable
 * - debounced so overlapping auth paths can't double-fire
 */
export function playStartupSound(): void {
  try {
    if (getLocalAudioMode() !== 'audible') return;

    // Debounce — login + 2FA verify can both reach 'complete' quickly
    const now = Date.now();
    if (now - lastPlayed < 3000) return;
    lastPlayed = now;

    playSoundAsset('login');
  } catch {
    // Audio is a nicety — never let it break the login flow
  }
}
