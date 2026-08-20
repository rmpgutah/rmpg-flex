// ============================================================
// RMPG Flex — Dispatch Alert Tones
// Audible tone alerts for dispatch events using Web Audio API.
// Follows the same AudioContext → OscillatorNode → GainNode
// pattern established in PanicButton.tsx (Motorola MCC7500).
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

import { emitSettingsChange } from './settingsBus';
import { startSoundAsset } from './soundAssets';

// A `SoundId` names one entry in the Motorola sound LIBRARY (an actual sound).
// `ToneType` is the same union, kept as the public name callers pass — but a
// caller-passed value is treated as a FUNCTION SLOT and resolved through the
// user's sound map (see getSlotSound / playTone) before a profile is chosen.
type SoundId =
  | 'caution' | 'warning' | 'info' | 'error' | 'alarm' | 'alert'
  | 'chirp' | 'double_chirp' | 'descending' | 'p1_alert' | 'panic_continuous'
  // ── Motorola APX 7500 P25 radio tones ──
  | 'key_up'        // Talk Permit Tone — "go ahead, you may transmit"
  | 'key_out'       // De-key courtesy / roger beep — end of transmission
  | 'radio_grant'   // Trunked channel-grant chirp
  | 'radio_deny'    // Busy / denied "bonk"
  // ── Extended Motorola lineup (library-only selectable sounds) ──
  | 'quick_call_2'  // Classic Quick Call II two-tone page
  | 'talk_permit_low' // Low-pitch talk-permit variant
  | 'call_alert'    // Motorola Call Alert "page" ring
  | 'knox_alert'    // Rapid hi-lo Knox/attention warble
  | 'squelch_tail'  // Short "kssht" noise burst on un-key
  | 'static_burst'  // Longer channel-noise hiss
  | 'boop'          // Single low de-key boop
  | 'dispatch_bell' // Gentle two-tone bell
  | 'data_chirp'    // Fast MDT data chirp
  | 'emergency_three' // Three-cycle emergency warble
  // ── Voice alert / navigation tones ──
  | 'gps_warn'
  | 'gps_lost'
  | 'gps_restored'
  | 'pursuit_alert'
  | 'beat_breach'
  // ── Voice comm tones ──
  | 'roger'
  | 'backup_request'
  // ── Status / dispatch tones ──
  | 'ack'
  | 'bonk'
  | 'login_ok'
  | 'logoff'
  | 'all_call'
  | 'unit_to_unit'
  | 'priority_preempt'
  | 'stack_pip'
  | 'enroute_chirp'
  | 'onscene_chirp'
  | 'cleared_chirp';

// Backward-compatible public alias used by all existing callers.
type ToneType = SoundId;

let audioCtx: AudioContext | null = null;

/** Lazy-init a shared AudioContext (browser requires user gesture). */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
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
  freq: number;       // Hz (starting frequency, or bandpass center for noise)
  start: number;      // offset in seconds from tone start
  dur: number;        // duration of this step in seconds
  /** When set, the pitch glides smoothly from `freq` to this value over
   *  the step's duration (a true sweep, not a stair-step). Used for the
   *  digital-radio talk-permit onset and trunking grant chirp. */
  glideTo?: number;
  /** When true, this step is band-passed white noise (squelch / static)
   *  centered on `freq`, instead of an oscillator tone. */
  noise?: boolean;
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
  // Single 1000 Hz triangle pip, 55ms — the classic Spillman Flex
  // "command accepted" beep heard on every successful MDT action.
  // Triangle wave for a warmer, console-like timbre.
  info: {
    type: 'triangle',
    gain: 0.20,
    steps: [
      { freq: 1000, start: 0, dur: 0.055 },
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

  // ── Error: Motorola NACK "buh-buh" (negative acknowledgment) ──
  // A4 → F4 (440 → 349 Hz) square-wave buzz, each 120ms — the
  // Motorola console command-rejected tone ("bonk"). Square wave
  // matches the slightly buzzy, reed-like character of the real
  // console speaker. Matches error.wav rendered by generate-ui-sounds.js.
  error: {
    type: 'square',
    gain: 0.10,
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

  // ── Chirp: Unit en-route status chirp ──────────────────────
  // 800 → 1200 Hz ascending two-step, 60ms per step — the Spillman
  // status-update pip for a unit moving to en-route. Lengthened from
  // the original 30ms so the tone is audible on MDT speakers.
  // Matches chirp.wav rendered by generate-ui-sounds.js.
  chirp: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 800,  start: 0,    dur: 0.06 },
      { freq: 1200, start: 0.06, dur: 0.06 },
    ],
  },

  // ── Double Chirp: Unit on-scene confirmation ────────────────
  // Two 800→1200 Hz rising pips, 60ms each, 60ms inter-pip gap.
  // Matches double_chirp.wav rendered by generate-ui-sounds.js.
  double_chirp: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 800,  start: 0,    dur: 0.06 },
      { freq: 1200, start: 0.06, dur: 0.06 },
      { freq: 800,  start: 0.18, dur: 0.06 },
      { freq: 1200, start: 0.24, dur: 0.06 },
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

  // ── Backup Request: Officer-down / assistance tone ───────────
  // Rapid triple beep at 1000 Hz — the CAD-standard "assistance
  // requested" urgency pattern distinct from pursuit or general alert.
  backup_request: {
    type: 'sine',
    gain: 0.28,
    steps: [
      { freq: 1000, start: 0,    dur: 0.10 },
      { freq: 0,    start: 0.10, dur: 0.06 },
      { freq: 1000, start: 0.16, dur: 0.10 },
      { freq: 0,    start: 0.26, dur: 0.06 },
      { freq: 1000, start: 0.32, dur: 0.10 },
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

  // ── Key Up: Motorola APX Talk Permit Tone (TPT) ────────────
  // Real APX trunking TPT: three 910 Hz chirps, tri-format cadence
  // (30ms on / 20ms off / 30ms on / 20ms off / 50ms on).
  // WAV asset is a real hardware recording (Moto_Tri_TPT.mp3 via W2SJW).
  // This synth fallback approximates the shape when WAV is unavailable.
  key_up: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 910, start: 0,    dur: 0.030 },
      { freq: 910, start: 0.05, dur: 0.030 },
      { freq: 910, start: 0.10, dur: 0.050 },
    ],
  },

  // ── Key Out: De-key — APX P25 systems typically no audible beep ─
  // On P25 digital trunking, the channel release is silent in most
  // APX configurations. Short 910 Hz pip (30ms) as a subtle UI cue.
  key_out: {
    type: 'sine',
    gain: 0.12,
    steps: [
      { freq: 910, start: 0, dur: 0.030 },
    ],
  },

  // ── Radio Grant: trunked channel-grant chirp ────────────────
  // Quick rising 600→1200 Hz sweep (≈80ms) — the digital "chirp"
  // when the trunking system assigns a working channel. Smooth glide.
  radio_grant: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 600, glideTo: 1200, start: 0, dur: 0.08 },
    ],
  },

  // ── Radio Deny: Motorola APX/XTS TX Denied Tone ─────────────
  // Real APX TX Denied: single continuous ~900 Hz tone, ~500ms.
  // WAV asset is a real hardware recording (APX_Denied.mp3 via W2SJW).
  // This synth fallback approximates the single-tone shape.
  radio_deny: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 900, start: 0, dur: 0.50 },
    ],
  },

  // ── Quick Call II — classic Motorola two-tone page ──────────
  // Longer sequential A-tone → B-tone pair (947 → 1153 Hz, 0.4s each),
  // the unmistakable "fire/EMS page" cadence.
  quick_call_2: {
    type: 'sine',
    gain: 0.26,
    steps: [
      { freq: 947,  start: 0,    dur: 0.4 },
      { freq: 1153, start: 0.42, dur: 0.4 },
    ],
  },

  // ── Talk Permit (Low) — MotoTRBO / DMR conventional TPT ─────
  // MotoTRBO Normal Talk Permit Tone (DMR conventional, non-trunked).
  // WAV asset is a real recording (TRBO_Normal_TPT.mp3 via W2SJW).
  // Synth fallback: single 900 Hz pip ~230ms (shorter than APX trunk TPT).
  talk_permit_low: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 900, start: 0, dur: 0.23 },
    ],
  },

  // ── Call Alert — Motorola "page" ring (4 rapid pips) ────────
  call_alert: {
    type: 'sine',
    gain: 0.24,
    steps: [
      { freq: 1000, start: 0,    dur: 0.08 },
      { freq: 1000, start: 0.16, dur: 0.08 },
      { freq: 1000, start: 0.32, dur: 0.08 },
      { freq: 1000, start: 0.48, dur: 0.08 },
    ],
  },

  // ── Knox Alert — rapid hi-lo attention warble ───────────────
  knox_alert: {
    type: 'sine',
    gain: 0.28,
    steps: [
      { freq: 1200, start: 0,    dur: 0.07 },
      { freq: 900,  start: 0.08, dur: 0.07 },
      { freq: 1200, start: 0.16, dur: 0.07 },
      { freq: 900,  start: 0.24, dur: 0.07 },
      { freq: 1200, start: 0.32, dur: 0.07 },
      { freq: 900,  start: 0.40, dur: 0.07 },
    ],
  },

  // ── Squelch Tail — short "kssht" noise burst on un-key ──────
  squelch_tail: {
    type: 'sine', // ignored — noise steps use a filtered buffer source
    gain: 0.30,
    steps: [
      { freq: 1800, start: 0, dur: 0.12, noise: true },
    ],
  },

  // ── Static Burst — longer channel-noise hiss ────────────────
  static_burst: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 1500, start: 0, dur: 0.32, noise: true },
    ],
  },

  // ── Boop — single low de-key boop ───────────────────────────
  boop: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 480, start: 0, dur: 0.12 },
    ],
  },

  // ── Dispatch Bell — Spillman Flex Premier CAD two-tone chime ─
  // E6 → B5 (1318 → 988 Hz) descending sine chime — the signature
  // Spillman/Motorola Premier CAD "ding-bong" that precedes every
  // new-call readback. First tone 160ms, second 220ms for the
  // deliberate "bong" landing. Matches dispatch_bell.wav rendered
  // by generate-ui-sounds.js (corrected from legacy 1060/880 Hz).
  dispatch_bell: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 1318, start: 0,    dur: 0.16 },
      { freq: 988,  start: 0.14, dur: 0.22 },
    ],
  },

  // ── Data Chirp — fast MDT data sweep (1500 → 2200 Hz) ───────
  data_chirp: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 1500, glideTo: 2200, start: 0, dur: 0.05 },
    ],
  },

  // ── Emergency (Three) — three-cycle warble, shorter alarm ───
  emergency_three: {
    type: 'sine',
    gain: 0.33,
    steps: [
      { freq: 800,  start: 0,    dur: 0.09 },
      { freq: 1100, start: 0.10, dur: 0.09 },
      { freq: 800,  start: 0.20, dur: 0.09 },
      { freq: 1100, start: 0.30, dur: 0.09 },
      { freq: 800,  start: 0.40, dur: 0.09 },
      { freq: 1100, start: 0.50, dur: 0.09 },
    ],
  },

};

// ─── User Sound Map (function slot → library sound) ─────────
// Callers trigger a semantic FUNCTION SLOT (e.g. 'warning'); the user can
// remap any slot to a different Motorola library sound via the Settings page.
// Stored as a single JSON object under one key. Absent → identity (default).

const TONE_MAP_KEY = 'rmpg-tone-map';

function readToneMap(): Partial<Record<string, SoundId>> {
  try {
    const raw = localStorage.getItem(TONE_MAP_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<string, SoundId>>) : {};
  } catch {
    return {};
  }
}

/** Resolve a function slot to the sound the user has assigned (or its default). */
export function getSlotSound(slot: ToneType): SoundId {
  const mapped = readToneMap()[slot];
  return mapped && mapped in PROFILES ? mapped : slot;
}

/** Assign a library sound to a function slot. */
export function setSlotSound(slot: ToneType, sound: SoundId): void {
  try {
    const map = readToneMap();
    if (sound === slot) delete map[slot]; // identity → drop override
    else map[slot] = sound;
    localStorage.setItem(TONE_MAP_KEY, JSON.stringify(map));
  } catch { /* quota / unavailable */ }
  emitSettingsChange('tones');
}

/** Restore all slots to their Motorola defaults. */
export function resetToneMap(): void {
  try { localStorage.removeItem(TONE_MAP_KEY); } catch { /* noop */ }
  emitSettingsChange('tones');
}

// ─── Audio rendering ────────────────────────────────────────

/** Render one library sound by id. Bypasses the slot map (used for preview). */
export function playSound(sound: SoundId): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;

  // Sampled console audio (actual WAV asset in /sounds/, rendered by
  // scripts/generate-ui-sounds.js) — the oscillator synth below is the
  // fallback for first-play-before-decode / missing asset / no WebAudio.
  const sampled = startSoundAsset(sound, PROFILES[sound].gain);
  if (sampled) return sampled;

  try {
    const ctx = getAudioContext();
    if (!ctx) return null;
    const profile = PROFILES[sound];
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.value = profile.gain;
    masterGain.connect(ctx.destination);

    const sources: AudioScheduledSourceNode[] = [];

    for (const step of profile.steps) {
      const stepStart = now + step.start;
      const stepEnd = stepStart + step.dur;

      // Per-step gain envelope (fade in / out to prevent clicks)
      const stepGain = ctx.createGain();
      stepGain.gain.setValueAtTime(0, stepStart);
      stepGain.gain.linearRampToValueAtTime(1, stepStart + 0.01);
      stepGain.gain.setValueAtTime(1, Math.max(stepStart + 0.01, stepEnd - 0.01));
      stepGain.gain.linearRampToValueAtTime(0, stepEnd);
      stepGain.connect(masterGain);

      if (step.noise) {
        // Band-passed white noise → authentic squelch / static "kssht".
        const len = Math.max(1, Math.ceil(ctx.sampleRate * step.dur));
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = step.freq;
        bp.Q.value = 0.7;
        src.connect(bp);
        bp.connect(stepGain);
        src.start(stepStart);
        src.stop(stepEnd);
        sources.push(src);
      } else {
        const osc = ctx.createOscillator();
        osc.type = profile.type;
        if (step.glideTo != null) {
          osc.frequency.setValueAtTime(step.freq, stepStart);
          osc.frequency.linearRampToValueAtTime(step.glideTo, stepEnd);
        } else {
          osc.frequency.value = step.freq;
        }
        osc.connect(stepGain);
        osc.start(stepStart);
        osc.stop(stepEnd);
        sources.push(osc);
      }
    }

    return {
      stop: () => {
        try {
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          for (const s of sources) {
            try { s.stop(); } catch { /* already stopped */ }
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
 * Play a dispatch alert for a function SLOT. The slot is resolved through
 * the user's sound map before rendering, so reassignments take effect at
 * every existing call site with no code change.
 */
export function playTone(slot: ToneType): { stop: () => void } | null {
  return playSound(getSlotSound(slot));
}

/**
 * Play a slot's tone and resolve when it completes.
 * Useful for awaiting tone completion before subsequent actions.
 */
export function playToneAsync(slot: ToneType): Promise<void> {
  const profile = PROFILES[getSlotSound(slot)];
  const totalDuration = Math.max(...profile.steps.map(s => s.start + s.dur));
  playTone(slot);
  return new Promise(resolve => setTimeout(resolve, totalDuration * 1000 + 50));
}

// ─── Catalog (for the Settings UI) ──────────────────────────

export interface SoundCatalogEntry {
  id: SoundId;
  label: string;
  category: 'Dispatch' | 'Radio' | 'Status' | 'Alert' | 'Noise';
}

/** Full Motorola sound library — every selectable sound, grouped. */
export const SOUND_LIBRARY: SoundCatalogEntry[] = [
  { id: 'caution',          label: 'Quick Call II (Attention)', category: 'Dispatch' },
  { id: 'quick_call_2',     label: 'Quick Call II (Long Page)',  category: 'Dispatch' },
  { id: 'dispatch_bell',    label: 'Dispatch Bell',              category: 'Dispatch' },
  { id: 'call_alert',       label: 'Call Alert (Page Ring)',     category: 'Dispatch' },
  { id: 'alert',            label: 'P25 Three-Pip',              category: 'Alert' },
  { id: 'warning',          label: 'Hi-Lo Yelp',                 category: 'Alert' },
  { id: 'p1_alert',         label: 'Priority-1 Warble',          category: 'Alert' },
  { id: 'knox_alert',       label: 'Knox Hi-Lo Warble',          category: 'Alert' },
  { id: 'alarm',            label: 'APX Emergency Warble',        category: 'Alert' },
  { id: 'emergency_three',  label: 'Emergency (3-cycle)',        category: 'Alert' },
  { id: 'panic_continuous', label: 'Panic (Continuous)',         category: 'Alert' },
  { id: 'info',             label: 'MDT Ack Pip',                category: 'Status' },
  { id: 'chirp',            label: 'En-Route Chirp',             category: 'Status' },
  { id: 'double_chirp',     label: 'On-Scene Double Chirp',      category: 'Status' },
  { id: 'descending',       label: 'Call-Cleared Descend',       category: 'Status' },
  { id: 'data_chirp',       label: 'MDT Data Chirp',             category: 'Status' },
  { id: 'error',            label: 'Error / NACK',               category: 'Status' },
  { id: 'key_up',           label: 'Talk Permit (Key Up)',       category: 'Radio' },
  { id: 'talk_permit_low',  label: 'Talk Permit (Low)',          category: 'Radio' },
  { id: 'key_out',          label: 'De-Key Roger Beep',          category: 'Radio' },
  { id: 'boop',             label: 'De-Key Boop',                category: 'Radio' },
  { id: 'radio_grant',      label: 'Channel Grant Chirp',        category: 'Radio' },
  { id: 'radio_deny',       label: 'Busy / Deny Bonk',           category: 'Radio' },
  { id: 'squelch_tail',     label: 'Squelch Tail',               category: 'Noise' },
  { id: 'static_burst',     label: 'Static Burst',               category: 'Noise' },
];

/** Function slots callers actually trigger, with friendly labels + defaults. */
export interface ToneSlot {
  slot: ToneType;
  label: string;
  desc: string;
  defaultSound: SoundId;
}

export const TONE_SLOTS: ToneSlot[] = [
  { slot: 'caution',      label: 'Dispatch Attention', desc: 'New routine call / broadcast', defaultSound: 'caution' },
  { slot: 'warning',      label: 'Priority / Hazard',  desc: 'Flags, hits, high priority',   defaultSound: 'warning' },
  { slot: 'p1_alert',     label: 'Priority 1 Call',    desc: 'Top-priority dispatch',        defaultSound: 'p1_alert' },
  { slot: 'alarm',        label: 'Emergency / Panic',  desc: 'Panic, officer down, pursuit', defaultSound: 'alarm' },
  { slot: 'alert',        label: 'BOLO / All-Units',   desc: 'BOLO, warrant, backup',        defaultSound: 'alert' },
  { slot: 'info',         label: 'Acknowledgment',     desc: 'Status updates, MDT acks',     defaultSound: 'info' },
  { slot: 'chirp',        label: 'Unit En Route',      desc: 'En-route confirmation',        defaultSound: 'chirp' },
  { slot: 'double_chirp', label: 'Unit On Scene',      desc: 'Arrival confirmation',         defaultSound: 'double_chirp' },
  { slot: 'descending',   label: 'Call Cleared',       desc: 'Call closed / completed',      defaultSound: 'descending' },
  { slot: 'error',        label: 'Error / Reject',     desc: 'Command errors, failures',     defaultSound: 'error' },
];

export type { ToneType, SoundId };
