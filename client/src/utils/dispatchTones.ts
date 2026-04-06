// ============================================================
// RMPG Flex — Dispatch Alert Tones
// Audible tone alerts for dispatch events using Web Audio API.
// Follows the same AudioContext → OscillatorNode → GainNode
// pattern established in PanicButton.tsx (Motorola MCC7500).
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

type ToneType = 'caution' | 'warning' | 'info' | 'error' | 'alarm';

let audioCtx: AudioContext | null = null;

/** Lazy-init a shared AudioContext (browser requires user gesture). */
function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (Chrome autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Check if the user has muted sounds via the MenuBar toggle. */
function isSoundEnabled(): boolean {
  return localStorage.getItem('rmpg-sound') !== 'false';
}

// ─── Tone Profiles ──────────────────────────────────────────
// Each profile defines oscillator type, frequency schedule,
// total duration, and gain envelope.

interface ToneStep {
  freq: number;   // Hz
  start: number;  // offset in seconds from tone start
  dur: number;    // duration of this step in seconds
}

interface ToneProfile {
  type: OscillatorType;
  gain: number;
  steps: ToneStep[];
}

const PROFILES: Record<ToneType, ToneProfile> = {
  // ── Info: Short confirmation beep (command acknowledged)
  info: {
    type: 'sine',
    gain: 0.2,
    steps: [{ freq: 880, start: 0, dur: 0.08 }],
  },

  // ── Caution: Single low tone (address has prior calls, no warnings)
  caution: {
    type: 'sine',
    gain: 0.28,
    steps: [
      { freq: 440, start: 0, dur: 0.3 },
    ],
  },

  // ── Warning: Double ascending tone (prior calls WITH warnings — ARMED, WARRANT, DV)
  warning: {
    type: 'sine',
    gain: 0.32,
    steps: [
      { freq: 660,  start: 0,    dur: 0.2 },
      { freq: 880,  start: 0.25, dur: 0.2 },
      { freq: 660,  start: 0.5,  dur: 0.2 },
      { freq: 880,  start: 0.75, dur: 0.2 },
    ],
  },

  // ── Error: Descending two-tone (command failed / error)
  error: {
    type: 'square',
    gain: 0.15,
    steps: [
      { freq: 400, start: 0,    dur: 0.15 },
      { freq: 280, start: 0.18, dur: 0.15 },
    ],
  },

  // ── Alarm: Repeating urgent two-tone (dispatch timer overdue)
  alarm: {
    type: 'square',
    gain: 0.25,
    steps: [
      { freq: 800, start: 0,    dur: 0.12 },
      { freq: 600, start: 0.15, dur: 0.12 },
      { freq: 800, start: 0.35, dur: 0.12 },
      { freq: 600, start: 0.50, dur: 0.12 },
      { freq: 800, start: 0.70, dur: 0.12 },
      { freq: 600, start: 0.85, dur: 0.12 },
    ],
  },
};

/**
 * Play a dispatch alert tone.
 * Returns a handle to stop the tone early (optional).
 */
export function playTone(tone: ToneType): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;

  try {
    const ctx = getAudioContext();
    const profile = PROFILES[tone];
    const now = ctx.currentTime;

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = profile.gain;
    masterGain.connect(ctx.destination);

    const oscillators: OscillatorNode[] = [];

    for (const step of profile.steps) {
      const osc = ctx.createOscillator();
      osc.type = profile.type;
      osc.frequency.value = step.freq;

      // Per-step gain envelope (fade in / out to prevent clicks)
      const stepGain = ctx.createGain();
      stepGain.gain.setValueAtTime(0, now + step.start);
      stepGain.gain.linearRampToValueAtTime(1, now + step.start + 0.01);
      stepGain.gain.setValueAtTime(1, now + step.start + step.dur - 0.01);
      stepGain.gain.linearRampToValueAtTime(0, now + step.start + step.dur);

      osc.connect(stepGain);
      stepGain.connect(masterGain);

      osc.start(now + step.start);
      osc.stop(now + step.start + step.dur);
      oscillators.push(osc);
    }

    return {
      stop: () => {
        try {
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          for (const osc of oscillators) {
            try { osc.stop(); } catch { /* already stopped */ }
          }
        } catch { /* context closed */ }
      },
    };
  } catch {
    // AudioContext not available (e.g. no user gesture yet)
    return null;
  }
}

/**
 * Play a tone and return a promise that resolves when the tone completes.
 * Useful for awaiting tone completion before subsequent actions.
 */
export function playToneAsync(tone: ToneType): Promise<void> {
  const profile = PROFILES[tone];
  const totalDuration = Math.max(...profile.steps.map(s => s.start + s.dur));
  playTone(tone);
  return new Promise(resolve => setTimeout(resolve, totalDuration * 1000 + 50));
}

export type { ToneType };
