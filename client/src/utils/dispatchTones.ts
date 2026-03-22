// ============================================================
// RMPG Flex — Dispatch Alert Tones
// Audible tone alerts for dispatch events using Web Audio API.
// Follows the same AudioContext → OscillatorNode → GainNode
// pattern established in PanicButton.tsx (Motorola MCC7500).
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

type ToneType = 'caution' | 'warning' | 'info' | 'error' | 'alarm' | 'alert';

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

// ─── Motorola Spillman Flex / MCC7500 / P25 Emergency Radio Tone Profiles ──
// Frequencies and cadences match real Motorola CAD console and APX radio tones:
//   • Quick Call II two-tone paging (853.1 / 960.0 Hz standard pair)
//   • P25 "3-pip" attention getter (A5 → C6 → E6 major triad)
//   • Hi-Lo siren yelp pattern (1050 / 1450 Hz alternating)
//   • APX panic warble (rapid 800 / 1000 Hz alternation)
//   • MDT keystroke acknowledgment pip (1000 Hz, 50ms)
// All tones use sine waves for clean, radio-like audio. Gain is calibrated
// so tones are audible but not jarring through laptop speakers.

const PROFILES: Record<ToneType, ToneProfile> = {

  // ── Info: MDT keystroke acknowledgment pip ───────────────────
  // Single 1000 Hz sine pip, 50ms — the classic Spillman Flex
  // "command accepted" beep heard on every successful MDT action.
  info: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 1000, start: 0, dur: 0.05 },
    ],
  },

  // ── Caution: Quick Call II dispatch attention tone ───────────
  // Sequential two-tone paging: 853.1 Hz → 960.0 Hz, each 330ms.
  // This is the standard Motorola Quick Call II pair used by
  // dispatchers to get a unit's attention before voice traffic.
  // Heard on every new dispatch assignment and call broadcast.
  caution: {
    type: 'sine',
    gain: 0.25,
    steps: [
      { freq: 853,  start: 0,    dur: 0.33 },
      { freq: 960,  start: 0.35, dur: 0.33 },
    ],
  },

  // ── Warning: Hi-Lo siren yelp (high-priority flag) ──────────
  // Alternating 1050 / 1450 Hz at ~3 Hz cadence — matches the
  // Motorola "Yelp" siren pattern used for priority dispatch.
  // Triggers on ARMED, WARRANT, DV, or other caution flags.
  // Three full cycles for unmistakable urgency.
  warning: {
    type: 'sine',
    gain: 0.28,
    steps: [
      { freq: 1050, start: 0,    dur: 0.15 },
      { freq: 1450, start: 0.17, dur: 0.15 },
      { freq: 1050, start: 0.34, dur: 0.15 },
      { freq: 1450, start: 0.51, dur: 0.15 },
      { freq: 1050, start: 0.68, dur: 0.15 },
      { freq: 1450, start: 0.85, dur: 0.15 },
    ],
  },

  // ── Error: Descending minor third (negative acknowledgment) ─
  // 440 Hz → 349 Hz (A4 → F4), each 120ms with square wave for
  // that classic "error buzz" feel. Universally recognized as a
  // failure/rejection tone. Used for command errors, API failures.
  error: {
    type: 'square',
    gain: 0.12,
    steps: [
      { freq: 440, start: 0,    dur: 0.12 },
      { freq: 349, start: 0.15, dur: 0.12 },
    ],
  },

  // ── Alert: P25 three-pip attention getter ───────────────────
  // A5 → C6 → E6 (880 → 1047 → 1319 Hz) ascending major triad,
  // each 80ms with 30ms gaps. This is the standard P25 digital
  // radio "3-beep" alert heard before BOLO broadcasts, warrant
  // hits, backup requests, and all-units advisories.
  alert: {
    type: 'sine',
    gain: 0.30,
    steps: [
      { freq: 880,  start: 0,    dur: 0.08 },
      { freq: 1047, start: 0.11, dur: 0.08 },
      { freq: 1319, start: 0.22, dur: 0.10 },
    ],
  },

  // ── Alarm: APX emergency warble (panic / officer down) ──────
  // Rapid 800 / 1000 Hz alternation at ~5 Hz — matches the
  // Motorola APX radio emergency beacon and Knox-Box panic alarm
  // cadence. Six half-cycles create the distinctive "warble" that
  // every officer recognizes as panic/emergency. Used for panic
  // button activation, pursuit alerts, and dispatch timer overdue.
  alarm: {
    type: 'sine',
    gain: 0.32,
    steps: [
      { freq: 800,  start: 0,    dur: 0.09 },
      { freq: 1000, start: 0.10, dur: 0.09 },
      { freq: 800,  start: 0.20, dur: 0.09 },
      { freq: 1000, start: 0.30, dur: 0.09 },
      { freq: 800,  start: 0.40, dur: 0.09 },
      { freq: 1000, start: 0.50, dur: 0.09 },
      { freq: 800,  start: 0.60, dur: 0.09 },
      { freq: 1000, start: 0.70, dur: 0.09 },
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
