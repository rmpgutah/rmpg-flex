// ============================================================
// RMPG Flex — Startup Sound
// A short synthesized "system online" chime played once after a
// successful login/2FA, akin to the Windows/macOS startup sound.
// Synthesized with WebAudio (no asset download, works offline,
// same approach as dispatchTones.ts). Respects the per-unit
// silent-dispatch audio mode.
// ============================================================
import { getLocalAudioMode } from './audioMode';

/** Ascending D-major arpeggio (D4, A4, D5, F#5) — command-console feel. */
const NOTES = [293.66, 440.0, 587.33, 739.99];
const NOTE_SPACING = 0.11; // s between note onsets
const NOTE_LENGTH = 1.1;   // s decay tail per note

let lastPlayed = 0;

/**
 * Play the login chime. Safe to call unconditionally:
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

    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    // Login click is a user gesture, but be defensive about suspended state
    if (ctx.state === 'suspended') void ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.22;
    // Gentle lowpass keeps the sines warm rather than glassy
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    master.connect(filter);
    filter.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.02;
    NOTES.forEach((freq, i) => {
      const start = t0 + i * NOTE_SPACING;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Slightly detuned second voice for shimmer
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 1.003;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(i === NOTES.length - 1 ? 0.5 : 0.32, start + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_LENGTH);

      osc.connect(env);
      osc2.connect(env);
      env.connect(master);
      osc.start(start);
      osc2.start(start);
      osc.stop(start + NOTE_LENGTH + 0.05);
      osc2.stop(start + NOTE_LENGTH + 0.05);
    });

    // Free the context once the tail has rung out
    const total = (NOTES.length * NOTE_SPACING + NOTE_LENGTH + 0.3) * 1000;
    setTimeout(() => { void ctx.close().catch(() => { /* already closed */ }); }, total);
  } catch {
    // Audio is a nicety — never let it break the login flow
  }
}
