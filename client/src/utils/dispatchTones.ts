// ============================================================
// RMPG Flex — Dispatch Alert Tones
// Audible tone alerts for dispatch events using Web Audio API.
// Follows the same AudioContext → OscillatorNode → GainNode
// pattern established in PanicButton.tsx (Motorola MCC7500).
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

type ToneType =
  | 'caution' | 'warning' | 'info' | 'error' | 'alarm'
  | 'pursuit' | 'all_units' | 'code3' | 'officer_down'
  | 'timer_soft' | 'timer_urgent' | 'timer_critical' | 'stale_call' | 'overdue_checkin';

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

  // ── Pursuit: Fast alternating hi-lo siren (vehicle/foot pursuit)
  pursuit: {
    type: 'sawtooth',
    gain: 0.3,
    steps: [
      { freq: 900, start: 0,    dur: 0.1 },
      { freq: 700, start: 0.12, dur: 0.1 },
      { freq: 900, start: 0.24, dur: 0.1 },
      { freq: 700, start: 0.36, dur: 0.1 },
      { freq: 900, start: 0.48, dur: 0.1 },
      { freq: 700, start: 0.60, dur: 0.1 },
      { freq: 900, start: 0.72, dur: 0.1 },
      { freq: 700, start: 0.84, dur: 0.1 },
    ],
  },

  // ── All Units: Three ascending attention-grabbing pulses
  all_units: {
    type: 'sine',
    gain: 0.35,
    steps: [
      { freq: 523, start: 0,    dur: 0.15 },  // C5
      { freq: 659, start: 0.2,  dur: 0.15 },  // E5
      { freq: 784, start: 0.4,  dur: 0.25 },  // G5 (held longer)
    ],
  },

  // ── Code 3: Urgent warbling tone (emergency response, lights & sirens)
  code3: {
    type: 'sine',
    gain: 0.3,
    steps: [
      { freq: 760, start: 0,    dur: 0.08 },
      { freq: 960, start: 0.1,  dur: 0.08 },
      { freq: 760, start: 0.2,  dur: 0.08 },
      { freq: 960, start: 0.3,  dur: 0.08 },
      { freq: 760, start: 0.4,  dur: 0.08 },
      { freq: 960, start: 0.5,  dur: 0.08 },
      { freq: 760, start: 0.6,  dur: 0.08 },
      { freq: 960, start: 0.7,  dur: 0.15 },
    ],
  },

  // ── Officer Down: Long wailing tone (max urgency)
  officer_down: {
    type: 'sawtooth',
    gain: 0.4,
    steps: [
      { freq: 600,  start: 0,    dur: 0.3 },
      { freq: 1000, start: 0.35, dur: 0.3 },
      { freq: 600,  start: 0.7,  dur: 0.3 },
      { freq: 1000, start: 1.05, dur: 0.3 },
      { freq: 600,  start: 1.4,  dur: 0.3 },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // DISPATCH TIMER / OVERDUE TONES
  // Escalating severity: soft → urgent → critical
  // Each is distinctly different so dispatchers know the level
  // without looking at the screen.
  // ═══════════════════════════════════════════════════════════

  // ── Timer Soft: Gentle double-chime reminder
  // "Hey, this call is approaching its time limit."
  // Two soft bell-like tones, pleasant but noticeable.
  // Used at 75% of time threshold (e.g. 45min of 60min limit).
  timer_soft: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 698,  start: 0,    dur: 0.18 },   // F5 — warm
      { freq: 880,  start: 0.25, dur: 0.22 },   // A5 — resolved
    ],
  },

  // ── Timer Urgent: Triple pulse with rising urgency
  // "This call has hit its time limit. Needs attention now."
  // Three ascending pulses that speed up — creates psychological urgency.
  // Used at 100% of time threshold.
  timer_urgent: {
    type: 'sine',
    gain: 0.32,
    steps: [
      { freq: 587,  start: 0,    dur: 0.15 },   // D5
      { freq: 740,  start: 0.2,  dur: 0.15 },   // F#5
      { freq: 880,  start: 0.38, dur: 0.12 },   // A5 — shorter (faster)
      // Repeat with tighter spacing
      { freq: 587,  start: 0.6,  dur: 0.12 },
      { freq: 740,  start: 0.75, dur: 0.12 },
      { freq: 880,  start: 0.9,  dur: 0.1 },
    ],
  },

  // ── Timer Critical: Aggressive pulsing alarm
  // "This call is significantly overdue. Supervisor attention required."
  // Fast alternating high tones with sawtooth edge — impossible to ignore.
  // Used at 150%+ of time threshold.
  timer_critical: {
    type: 'sawtooth',
    gain: 0.35,
    steps: [
      { freq: 880,  start: 0,    dur: 0.08 },
      { freq: 1047, start: 0.1,  dur: 0.08 },   // C6
      { freq: 880,  start: 0.2,  dur: 0.08 },
      { freq: 1047, start: 0.3,  dur: 0.08 },
      { freq: 880,  start: 0.4,  dur: 0.08 },
      { freq: 1047, start: 0.5,  dur: 0.08 },
      // Hold high note — feels unresolved, demands action
      { freq: 1175, start: 0.62, dur: 0.25 },    // D6 held
      // Final descending stab
      { freq: 880,  start: 0.92, dur: 0.15 },
    ],
  },

  // ── Stale Call: Low pulsing drone
  // "This call has been sitting unassigned. Someone needs to pick it up."
  // Deep, slow, throbbing pulse — feels heavy, like something's been forgotten.
  // Used for calls pending > 5 minutes with no unit assigned.
  stale_call: {
    type: 'sine',
    gain: 0.25,
    steps: [
      { freq: 330,  start: 0,    dur: 0.35 },    // E4 — low, heavy
      { freq: 294,  start: 0.45, dur: 0.35 },    // D4 — descends
      { freq: 330,  start: 0.9,  dur: 0.35 },    // E4 — returns
      { freq: 294,  start: 1.35, dur: 0.35 },    // D4 — descends again
    ],
  },

  // ── Overdue Check-in: Stuttering alert
  // "An officer hasn't checked in. Welfare check may be needed."
  // Rapid stuttering pattern — sounds like a heartbeat monitor speeding up.
  // Used when an officer's status timer expires without update.
  overdue_checkin: {
    type: 'sine',
    gain: 0.3,
    steps: [
      // Heartbeat-like double-pulse pattern
      { freq: 523,  start: 0,    dur: 0.06 },    // C5
      { freq: 523,  start: 0.09, dur: 0.06 },    // C5 (double tap)
      // Pause...
      { freq: 523,  start: 0.35, dur: 0.06 },
      { freq: 523,  start: 0.44, dur: 0.06 },
      // Faster — urgency building
      { freq: 659,  start: 0.65, dur: 0.06 },    // E5 — pitch rises
      { freq: 659,  start: 0.74, dur: 0.06 },
      // Fastest
      { freq: 784,  start: 0.9,  dur: 0.06 },    // G5
      { freq: 784,  start: 0.98, dur: 0.06 },
      { freq: 784,  start: 1.06, dur: 0.06 },    // Triple tap — alarm
    ],
  },
};

/**
 * Play a dispatch alert tone with rich audio processing.
 *
 * Audio chain: Oscillator(s) → StepGain → Filter → Compressor → MasterGain → Destination
 *
 * Each tone step gets:
 * - A fundamental oscillator at the profile's waveform type
 * - An overtone oscillator at 2x frequency (sine, 30% amplitude) for warmth
 * - A sub-bass oscillator at 0.5x frequency (sine, 15% amplitude) for body
 * - Low-pass filter to remove harsh high-frequency content
 * - Smooth gain envelope with attack/release curves (not abrupt on/off)
 * - Dynamic compressor to prevent clipping and even out volume
 *
 * This produces tones that sound like professional dispatch console hardware
 * rather than raw browser oscillators.
 */
export function playTone(tone: ToneType): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;

  try {
    const ctx = getAudioContext();
    const profile = PROFILES[tone];
    const now = ctx.currentTime;

    // ── Audio processing chain ──
    // Compressor → smooths peaks, prevents clipping, adds "radio" character
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(ctx.destination);

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = profile.gain;
    masterGain.connect(compressor);

    // Low-pass filter — removes harsh harmonics, warms the tone
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3500; // Cut above 3.5kHz — radio-like warmth
    filter.Q.value = 0.7;
    filter.connect(masterGain);

    const oscillators: OscillatorNode[] = [];
    const ATTACK = 0.015;  // 15ms attack — snappy but click-free
    const RELEASE = 0.04;  // 40ms release — smooth tail

    for (const step of profile.steps) {
      // ── Fundamental oscillator ──
      const osc = ctx.createOscillator();
      osc.type = profile.type;
      osc.frequency.value = step.freq;

      const stepGain = ctx.createGain();
      stepGain.gain.setValueAtTime(0, now + step.start);
      stepGain.gain.linearRampToValueAtTime(1, now + step.start + ATTACK);
      stepGain.gain.setValueAtTime(1, now + step.start + step.dur - RELEASE);
      stepGain.gain.exponentialRampToValueAtTime(0.001, now + step.start + step.dur);

      osc.connect(stepGain);
      stepGain.connect(filter);
      osc.start(now + step.start);
      osc.stop(now + step.start + step.dur + 0.05);
      oscillators.push(osc);

      // ── Overtone (2nd harmonic) — adds brightness/presence ──
      if (step.freq < 1500) { // Only add harmonics for lower fundamentals
        const overtone = ctx.createOscillator();
        overtone.type = 'sine';
        overtone.frequency.value = step.freq * 2;

        const otGain = ctx.createGain();
        otGain.gain.setValueAtTime(0, now + step.start);
        otGain.gain.linearRampToValueAtTime(0.25, now + step.start + ATTACK);
        otGain.gain.setValueAtTime(0.25, now + step.start + step.dur - RELEASE);
        otGain.gain.exponentialRampToValueAtTime(0.001, now + step.start + step.dur);

        overtone.connect(otGain);
        otGain.connect(filter);
        overtone.start(now + step.start);
        overtone.stop(now + step.start + step.dur + 0.05);
        oscillators.push(overtone);
      }

      // ── Sub-bass (0.5x) — adds body/weight to alarm tones ──
      if (step.freq >= 400 && (profile.type === 'sawtooth' || profile.type === 'square')) {
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = step.freq * 0.5;

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0, now + step.start);
        subGain.gain.linearRampToValueAtTime(0.12, now + step.start + ATTACK * 2);
        subGain.gain.setValueAtTime(0.12, now + step.start + step.dur - RELEASE);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + step.start + step.dur);

        sub.connect(subGain);
        subGain.connect(filter);
        sub.start(now + step.start);
        sub.stop(now + step.start + step.dur + 0.05);
        oscillators.push(sub);
      }
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
    return null;
  }
}

/**
 * Play a tone and return a promise that resolves when the tone completes.
 */
export function playToneAsync(tone: ToneType): Promise<void> {
  const profile = PROFILES[tone];
  const totalDuration = Math.max(...profile.steps.map(s => s.start + s.dur));
  playTone(tone);
  return new Promise(resolve => setTimeout(resolve, totalDuration * 1000 + 80));
}

export type { ToneType };
