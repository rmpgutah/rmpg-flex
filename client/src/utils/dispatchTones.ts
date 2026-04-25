// ============================================================
// RMPG Flex — Dispatch Alert Tones
// Audible tone alerts for dispatch events using Web Audio API.
// Follows the same AudioContext → OscillatorNode → GainNode
// pattern established in PanicButton.tsx (Motorola MCC7500).
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

type ToneType = 'caution' | 'warning' | 'info' | 'error' | 'alarm' | 'alert' | 'chirp' | 'double_chirp' | 'descending' | 'p1_alert' | 'panic_continuous'
  | 'gps_warn' | 'gps_lost' | 'gps_restored' | 'pursuit_alert' | 'beat_breach' | 'ack'
  | 'bonk' | 'roger' | 'enroute_chirp' | 'onscene_chirp' | 'cleared_chirp'
  | 'all_call' | 'priority_preempt' | 'unit_to_unit' | 'stack_pip' | 'login_ok' | 'logoff';

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

  // ── Chirp: Brief MDT acknowledgment chirp ──────────────────
  // Single quick rising pip — used for unit en route confirmation.
  // 800 Hz → 1200 Hz sweep in 60ms. Minimal and non-intrusive.
  chirp: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 800,  start: 0,    dur: 0.03 },
      { freq: 1200, start: 0.03, dur: 0.03 },
    ],
  },

  // ── Double Chirp: Unit on scene confirmation ───────────────
  // Two quick rising pips with 80ms gap — confirms arrival.
  // Slightly louder than single chirp for emphasis.
  double_chirp: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 800,  start: 0,    dur: 0.03 },
      { freq: 1200, start: 0.03, dur: 0.03 },
      { freq: 800,  start: 0.14, dur: 0.03 },
      { freq: 1200, start: 0.17, dur: 0.03 },
    ],
  },

  // ── Descending: Call cleared / closed tone ─────────────────
  // C6 → A5 → F5 descending minor arpeggio (1047 → 880 → 698 Hz).
  // Each note 80ms. Universally recognized "task complete" feel.
  descending: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 1047, start: 0,    dur: 0.08 },
      { freq: 880,  start: 0.10, dur: 0.08 },
      { freq: 698,  start: 0.20, dur: 0.10 },
    ],
  },

  // ── P1 Alert: Double high-low-high emergency attention tone ─
  // For Priority 1 calls — two cycles of 1200 / 800 / 1200 Hz
  // sweep creating an unmistakable siren-like warble. Louder gain.
  p1_alert: {
    type: 'sine',
    gain: 0.35,
    steps: [
      { freq: 1200, start: 0,    dur: 0.10 },
      { freq: 800,  start: 0.12, dur: 0.10 },
      { freq: 1200, start: 0.24, dur: 0.10 },
      { freq: 800,  start: 0.40, dur: 0.10 },
      { freq: 1200, start: 0.52, dur: 0.10 },
      { freq: 800,  start: 0.64, dur: 0.10 },
    ],
  },

  // ── GPS Warn: 5-min staleness gentle 2-pip ───────────────────
  // Two soft sine pips at A5 (880 Hz), 100ms each, 200ms apart.
  // Calm but distinct — communicates "something went idle"
  // without pulling attention from active dispatch traffic.
  // Fires on gps:gap warning (5+ min OwnTracks silence).
  gps_warn: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 880, start: 0,    dur: 0.10 },
      { freq: 880, start: 0.30, dur: 0.10 },
    ],
  },

  // ── GPS Lost: 15-min critical gap, 3-pip descending ──────────
  // E6 → C6 → A5 (1318 → 1046 → 880 Hz), each 180ms, 30ms gap.
  // Descending = "loss / fall" — opposite of the ascending
  // restoration tone. Higher gain than gps_warn; designed to cut
  // through ambient noise so the dispatcher acts within seconds.
  // Pairs with TTS announcement "Unit XXXX GPS lost".
  gps_lost: {
    type: 'sine',
    gain: 0.32,
    steps: [
      { freq: 1318, start: 0,    dur: 0.18 },
      { freq: 1046, start: 0.21, dur: 0.18 },
      { freq: 880,  start: 0.42, dur: 0.22 },
    ],
  },

  // ── GPS Restored: 2-pip ascending recovery chime ─────────────
  // C6 → E6 (1046 → 1318 Hz), each 90ms. Rising = "recovery".
  // Brief and friendly — confirms the missing unit reported again.
  gps_restored: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 1046, start: 0,    dur: 0.09 },
      { freq: 1318, start: 0.11, dur: 0.12 },
    ],
  },

  // ── Pursuit Alert: 100+ mph escalation ───────────────────────
  // Aggressive APX-style warble at higher pitch (1200 / 1600 Hz)
  // for 1.6s. Distinguishable from regular speed alerts by the
  // higher frequency band and longer duration. Reserved for
  // pursuit-speed (>= 100 mph) events. Gain matches alarm tier.
  pursuit_alert: {
    type: 'sine',
    gain: 0.34,
    steps: [
      { freq: 1200, start: 0,    dur: 0.10 },
      { freq: 1600, start: 0.11, dur: 0.10 },
      { freq: 1200, start: 0.22, dur: 0.10 },
      { freq: 1600, start: 0.33, dur: 0.10 },
      { freq: 1200, start: 0.44, dur: 0.10 },
      { freq: 1600, start: 0.55, dur: 0.10 },
      { freq: 1200, start: 0.66, dur: 0.10 },
      { freq: 1600, start: 0.77, dur: 0.10 },
      { freq: 1200, start: 0.88, dur: 0.10 },
      { freq: 1600, start: 0.99, dur: 0.10 },
      { freq: 1200, start: 1.10, dur: 0.10 },
      { freq: 1600, start: 1.21, dur: 0.10 },
      { freq: 1200, start: 1.32, dur: 0.10 },
      { freq: 1600, start: 1.43, dur: 0.10 },
    ],
  },

  // ── Beat Breach: Single distinctive notch tone ───────────────
  // Triangle wave at 660 Hz for 200ms — softer than sine, evokes
  // the "boundary touched" feel without urgency. For unit_outside_beat.
  beat_breach: {
    type: 'triangle',
    gain: 0.22,
    steps: [
      { freq: 660, start: 0,    dur: 0.20 },
    ],
  },

  // ── Ack: Brief acknowledgment chip ───────────────────────────
  // Short 1500 Hz pip, 40ms — confirms a dispatcher action
  // (alert dismissed, click-to-acknowledge). Inaudible if
  // preceded by another tone; intended as tactile feedback.
  ack: {
    type: 'sine',
    gain: 0.14,
    steps: [
      { freq: 1500, start: 0, dur: 0.04 },
    ],
  },

  // ── Bonk: Motorola/Spillman command-rejected tone ────────────
  // Classic descending two-step "wuh-wuh" — A4 → F4 (440 → 349 Hz),
  // each ~140ms, sawtooth wave for the slightly raspy texture
  // Spillman dispatch consoles are known for. Used when an action
  // is rejected (invalid command, permission denied, etc.).
  bonk: {
    type: 'sawtooth',
    gain: 0.20,
    steps: [
      { freq: 440, start: 0,    dur: 0.14 },
      { freq: 349, start: 0.15, dur: 0.18 },
    ],
  },

  // ── Roger: End-of-transmission confirmation pip ──────────────
  // Single brief 1200 Hz sine pip, 60ms — appended after every TTS
  // announcement to mimic the Motorola "Roger beep" / "courtesy
  // tone" that signals "transmission ended, channel free." Quiet
  // by design; it shouldn't compete with the voice itself.
  roger: {
    type: 'sine',
    gain: 0.15,
    steps: [
      { freq: 1200, start: 0, dur: 0.06 },
    ],
  },

  // ── Enroute Chirp: Unit reports enroute to call ──────────────
  // Single ascending step 700 → 900 Hz (60ms each, no gap).
  // Spillman uses one of three distinct status confirmations for
  // dispatch → enroute → on-scene → cleared transitions. Each is
  // a one-shot chirp learnable by sound alone.
  enroute_chirp: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 700, start: 0,    dur: 0.06 },
      { freq: 900, start: 0.06, dur: 0.06 },
    ],
  },

  // ── On-Scene Chirp: Unit arrived at call ─────────────────────
  // Two-pip A5 → C6 (880 → 1046 Hz), confirms "I'm there."
  // Slightly higher-energy than enroute since arriving is the
  // operationally-significant event for response-time metrics.
  onscene_chirp: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 880,  start: 0,    dur: 0.07 },
      { freq: 1046, start: 0.09, dur: 0.10 },
    ],
  },

  // ── Cleared Chirp: Unit cleared / available again ────────────
  // Descending 1100 → 700 Hz, 100ms each — "wrap up" pattern.
  // Closes the status-cycle audio bracket opened by enroute_chirp.
  cleared_chirp: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 1100, start: 0,    dur: 0.10 },
      { freq: 700,  start: 0.11, dur: 0.10 },
    ],
  },

  // ── All-Call: Extended attention tone for broadcasts ─────────
  // Slow Hi-Lo siren oscillation 800/1200 Hz at ~2 Hz cadence for
  // 1.4 seconds. Reserved for general broadcasts to ALL units —
  // BOLOs, weather alerts, all-call from supervisor. Distinct
  // from `warning` (faster Hi-Lo) and `panic_continuous` (rapid
  // warble). The slower cadence reads as "attention, all units
  // listen up" rather than "act now."
  all_call: {
    type: 'sine',
    gain: 0.28,
    steps: [
      { freq: 800,  start: 0.00, dur: 0.20 },
      { freq: 1200, start: 0.20, dur: 0.20 },
      { freq: 800,  start: 0.40, dur: 0.20 },
      { freq: 1200, start: 0.60, dur: 0.20 },
      { freq: 800,  start: 0.80, dur: 0.20 },
      { freq: 1200, start: 1.00, dur: 0.20 },
      { freq: 800,  start: 1.20, dur: 0.20 },
    ],
  },

  // ── Priority Preempt: Higher-pri call interrupts current ─────
  // Rising pair 600 → 1000 Hz (90ms each), no gap. Brief but
  // unambiguous "drop what you're doing" cue. Plays just before
  // a TTS announcement of the new priority call to alert the
  // dispatcher their attention should shift.
  priority_preempt: {
    type: 'sine',
    gain: 0.26,
    steps: [
      { freq: 600,  start: 0,    dur: 0.09 },
      { freq: 1000, start: 0.09, dur: 0.11 },
    ],
  },

  // ── Unit-to-Unit: Direct message between units ───────────────
  // Single triangle-wave pip at 1320 Hz, 80ms — softer than the
  // dispatch-to-unit Quick Call (caution profile) so it's clear
  // the message is intra-unit, not from console.
  unit_to_unit: {
    type: 'triangle',
    gain: 0.18,
    steps: [
      { freq: 1320, start: 0, dur: 0.08 },
    ],
  },

  // ── Stack Pip: Reminder for unacknowledged stacked alerts ────
  // Single soft 1500 Hz pip, 40ms, very low gain. Fires every
  // ~60 seconds while 2+ critical alerts remain unacknowledged.
  // Background nag — present enough to register, quiet enough not
  // to compete with active dispatch traffic.
  stack_pip: {
    type: 'sine',
    gain: 0.10,
    steps: [
      { freq: 1500, start: 0, dur: 0.04 },
    ],
  },

  // ── Login OK: Successful authentication chirp ────────────────
  // Three-step ascending major triad C5 → E5 → G5 (523/659/784 Hz),
  // 70ms each, no gap — classic "system ready" pattern. Plays once
  // when a dispatcher's session is established.
  login_ok: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 523, start: 0,    dur: 0.07 },
      { freq: 659, start: 0.07, dur: 0.07 },
      { freq: 784, start: 0.14, dur: 0.10 },
    ],
  },

  // ── Logoff: Session termination tone ─────────────────────────
  // Reverse of login_ok — descending G5 → E5 → C5. Closes the
  // session bracket. Quiet so it doesn't startle on shift change.
  logoff: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 784, start: 0,    dur: 0.07 },
      { freq: 659, start: 0.07, dur: 0.07 },
      { freq: 523, start: 0.14, dur: 0.10 },
    ],
  },

  // ── Panic Continuous: Extended alarm for panic events ───────
  // 12 rapid warble cycles (~2.5 seconds) — impossible to ignore.
  // Used exclusively for panic button activations.
  panic_continuous: {
    type: 'sine',
    gain: 0.35,
    steps: [
      { freq: 800,  start: 0,    dur: 0.09 },
      { freq: 1100, start: 0.10, dur: 0.09 },
      { freq: 800,  start: 0.20, dur: 0.09 },
      { freq: 1100, start: 0.30, dur: 0.09 },
      { freq: 800,  start: 0.40, dur: 0.09 },
      { freq: 1100, start: 0.50, dur: 0.09 },
      { freq: 800,  start: 0.60, dur: 0.09 },
      { freq: 1100, start: 0.70, dur: 0.09 },
      { freq: 800,  start: 0.80, dur: 0.09 },
      { freq: 1100, start: 0.90, dur: 0.09 },
      { freq: 800,  start: 1.00, dur: 0.09 },
      { freq: 1100, start: 1.10, dur: 0.09 },
      { freq: 800,  start: 1.20, dur: 0.09 },
      { freq: 1100, start: 1.30, dur: 0.09 },
      { freq: 800,  start: 1.40, dur: 0.09 },
      { freq: 1100, start: 1.50, dur: 0.09 },
      { freq: 800,  start: 1.60, dur: 0.09 },
      { freq: 1100, start: 1.70, dur: 0.09 },
      { freq: 800,  start: 1.80, dur: 0.09 },
      { freq: 1100, start: 1.90, dur: 0.09 },
      { freq: 800,  start: 2.00, dur: 0.09 },
      { freq: 1100, start: 2.10, dur: 0.09 },
      { freq: 800,  start: 2.20, dur: 0.09 },
      { freq: 1100, start: 2.30, dur: 0.09 },
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
