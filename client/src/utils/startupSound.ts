// ============================================================
// RMPG Flex — Startup Sound (Spillman Flex / Motorola console)
// A terminal-style "sign-on acknowledge" played once after a
// successful login/2FA: two crisp data blips followed by a low
// confirmation tone — the public-safety console idiom, not a
// musical chime. Synthesized with WebAudio (no asset download,
// works offline, same approach as dispatchTones.ts). Respects
// the per-unit silent-dispatch audio mode.
// ============================================================
import { getLocalAudioMode } from './audioMode';
import { playSoundAsset } from './soundAssets';

/**
 * Tone schedule — Motorola-console-style sign-on acknowledge:
 * two short high "data" blips, then a firm low-mid confirm tone
 * with a slow release. Square-ish voicing through a lowpass gives
 * the dry, utilitarian MDT character.
 */
const SEQUENCE: Array<{ freq: number; at: number; dur: number; gain: number; type: OscillatorType }> = [
  { freq: 1318, at: 0.0, dur: 0.07, gain: 0.30, type: 'square' },   // blip 1
  { freq: 1760, at: 0.11, dur: 0.07, gain: 0.30, type: 'square' },  // blip 2
  { freq: 523, at: 0.26, dur: 0.55, gain: 0.42, type: 'triangle' }, // confirm
  { freq: 659, at: 0.26, dur: 0.55, gain: 0.20, type: 'triangle' }, // confirm 5th (subtle)
];

let lastPlayed = 0;

/**
 * Play the sign-on tone. Safe to call unconditionally:
 * - no-ops in silent/vibrate audio mode
 * - no-ops if WebAudio is unavailable or blocked (autoplay policy)
 * - debounced so overlapping auth paths can't double-fire
 */
export function playStartupSound(): void {
  try {
    if (getLocalAudioMode() !== 'audible') return;

    // Debounce — login + 2FA verify can both reach 'complete' quickly
    const now = Date.now();
    if (now - lastPlayed < 3000) return;
    lastPlayed = now;

    // Sampled sign-on acknowledge (actual audio asset); synth below is the fallback
    if (playSoundAsset('login')) return;

    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    // Login click is a user gesture, but be defensive about suspended state
    if (ctx.state === 'suspended') void ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.22;
    // Lowpass tames square-wave harmonics into the dry console timbre
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    master.connect(filter);
    filter.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.02;
    for (const step of SEQUENCE) {
      const start = t0 + step.at;
      const osc = ctx.createOscillator();
      osc.type = step.type;
      osc.frequency.value = step.freq;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(step.gain, start + 0.012);
      // Blips cut hard; the confirm tone releases slowly
      const release = step.dur > 0.2 ? step.dur : 0.04;
      env.gain.setValueAtTime(step.gain, start + step.dur - release * 0.9);
      env.gain.exponentialRampToValueAtTime(0.0001, start + step.dur);

      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + step.dur + 0.05);
    }

    // Free the context once the tail has rung out
    const last = SEQUENCE[SEQUENCE.length - 1];
    setTimeout(() => { void ctx.close().catch(() => { /* already closed */ }); }, (last.at + last.dur + 0.3) * 1000);
  } catch {
    // Audio is a nicety — never let it break the login flow
  }
}
