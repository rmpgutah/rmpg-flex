// ============================================================
// RMPG Flex — Dispatch Alert Tones
// Audible tone alerts for dispatch events using Web Audio API.
// Follows the same AudioContext → OscillatorNode → GainNode
// pattern established in PanicButton.tsx (Motorola MCC7500).
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

import { emitSettingsChange } from './settingsBus';

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
  | 'emergency_three'; // Three-cycle emergency warble

// Backward-compatible public alias used by all existing callers.
type ToneType = SoundId;

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

  // ── Key Up: Motorola APX 7500 Talk Permit Tone (TPT) ────────
  // The "go ahead" tone heard the instant a P25 trunked channel is
  // granted after pressing PTT. Authentic Motorola TPT centers on
  // ~913 Hz. We add a fast 760→913 Hz glide onset (≈45ms) — the
  // characteristic vocoder "snap" — then hold 913 Hz for ~110ms.
  // Play this BEFORE the officer/dispatcher starts talking.
  key_up: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 760, glideTo: 913, start: 0,    dur: 0.045 },
      { freq: 913,               start: 0.045, dur: 0.11 },
    ],
  },

  // ── Key Out: De-key courtesy / roger beep ───────────────────
  // The short descending "bee-boop" at the END of a transmission —
  // 900 Hz → 650 Hz, two quick pips. Signals "transmission complete,
  // channel released." Play this AFTER speech finishes.
  key_out: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 900, start: 0,    dur: 0.06 },
      { freq: 650, start: 0.07, dur: 0.07 },
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

  // ── Radio Deny: busy / denied "bonk" ────────────────────────
  // Low 310 Hz sawtooth buzz (~250ms) — the unmistakable Motorola
  // "bonk" heard when no channel is available or PTT is rejected.
  radio_deny: {
    type: 'sawtooth',
    gain: 0.16,
    steps: [
      { freq: 310, start: 0, dur: 0.25 },
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

  // ── Talk Permit (Low) — low-pitch go-ahead variant ──────────
  talk_permit_low: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 560, glideTo: 660, start: 0,    dur: 0.045 },
      { freq: 660,               start: 0.045, dur: 0.12 },
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

  // ── Dispatch Bell — gentle two-tone bell (E6 → B5) ──────────
  dispatch_bell: {
    type: 'sine',
    gain: 0.2,
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

  try {
    const ctx = getAudioContext();
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
