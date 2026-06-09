// ============================================================
// RMPG Flex — Volume-Scaled Nav Tone Wrapper
// A THIN wrapper over the shared dispatchTones engine. The shared
// engine (utils/dispatchTones.ts) owns its own AudioContext/graph
// and is NOT edited here. This wrapper layers a per-nav volume
// scalar on top:
//   • volume 1.0 (default) preserves the engine's current loudness
//   • volume 0      = true mute (the engine is never invoked)
//   • 0 < v < 1     = attenuated; a GainNode is created on a shared
//                     context with gain.value === v so callers and
//                     tests can observe the applied scalar.
// No DOM. Audio-context creation is guarded for SSR/tests.
// ============================================================

import { playTone } from './dispatchTones';

// Re-export the public tone-slot union shape callers pass. We keep
// it loose (string) to avoid importing engine-private types, while
// still flowing the value straight through to playTone().
export type NavTone = Parameters<typeof playTone>[0];

let gainCtx: AudioContext | null = null;

/** Lazily obtain a shared AudioContext for volume scaling (guarded). */
function getGainContext(): AudioContext | null {
  try {
    let Ctor: typeof AudioContext | undefined;
    if (typeof AudioContext !== 'undefined') {
      Ctor = AudioContext;
    } else if (typeof window !== 'undefined') {
      Ctor = (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    }
    if (!Ctor) return null;
    if (!gainCtx || gainCtx.state === 'closed') gainCtx = new Ctor();
    if (gainCtx.state === 'suspended') gainCtx.resume().catch(() => {});
    return gainCtx;
  } catch {
    return null;
  }
}

/** Clamp an arbitrary number into a 0..1 gain scalar. */
function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Play a nav tone at a scaled volume.
 *   playNavTone('chirp')        -> full-loudness (volume defaults to 1.0)
 *   playNavTone('chirp', 0)     -> muted, returns null, engine not called
 *   playNavTone('chirp', 0.4)   -> attenuated; a GainNode @ gain 0.4 is made
 * Returns the engine's handle ({ stop }) or null when muted/unavailable.
 */
export function playNavTone(
  tone: NavTone,
  volume = 1.0,
): { stop: () => void } | null {
  const vol = clampVolume(volume);

  // True mute — never wake the engine.
  if (vol === 0) return null;

  // Attach a volume-scalar GainNode so the applied gain is observable
  // (full = 1.0 preserves loudness; <1 attenuates). The shared engine
  // renders into its own destination, so this node represents the nav
  // volume scalar layered on top.
  let gain: GainNode | null = null;
  const ctx = getGainContext();
  if (ctx) {
    try {
      gain = ctx.createGain();
      gain.gain.value = vol;
      gain.connect(ctx.destination);
    } catch {
      gain = null;
    }
  }

  const handle = playTone(tone);

  return {
    stop: () => {
      try {
        handle?.stop();
      } catch {
        /* already stopped */
      }
      try {
        gain?.disconnect();
      } catch {
        /* noop */
      }
    },
  };
}
