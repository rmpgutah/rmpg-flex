// ============================================================
// RMPG Flex — Motorola APX Emergency Services Radio Tones
//
// Authentic Motorola radio sounds using Web Audio API:
//
// • MDC-1200 FSK burst for roger beep (1200/1800Hz rapid
//   frequency-shift keying on a single continuous oscillator)
// • Crisp 1050Hz talk-permit chirp (~40ms)
// • BiquadFilter bandpass to simulate radio speaker character
// • 1.5ms attack/decay — abrupt like real radio hardware
// • Squelch open/close static — white noise burst through
//   bandpass filter simulating FM squelch gate opening
// • Emergency alert warble — alternating 1545/2175Hz Motorola
//   standard emergency tone
//
// Respects the user's sound toggle (localStorage 'rmpg-sound').
// ============================================================

type RadioToneType =
  | 'pttChirp'       // Talk-permit tone on PTT key-down (before mic opens)
  | 'rogerBeep'      // MDC-1200 PTT-ID burst on PTT key-up
  | 'receiveStart'   // Incoming transmission indicator
  | 'receiveEnd'     // End of incoming transmission
  | 'channelChange'  // Zone/channel switch confirmation
  | 'channelDeny'    // TX denied — channel busy bonk
  | 'squelchOpen'    // Squelch gate opening static burst
  | 'squelchClose'   // Squelch tail — kerchunk static on TX end
  | 'emergency'      // Motorola emergency alert warble
  | 'lowBattery'     // Low battery warning triple-beep
  | 'scanHit'        // Scanner lock-on pip
  // ── Phase 3 tones ──
  | 'twoTonePage'    // Two-tone sequential paging (1000Hz + 2000Hz)
  | 'mdcDataBurst'   // Extended MDC-1200 data packet (40-bit FSK)
  | 'priorityAlert'  // Priority dispatch alert (triple pip + sustained)
  | 'radioCheck'     // Radio check request — triple pip
  | 'radioCheckAck'  // Radio check acknowledgment — ascending double-pip
  | 'selcallAlert';  // Selective call alert — alternating tones (loops)

import { getRadioAudioContext, getRadioAudioBus } from './radioAudioBus';

/**
 * Get the shared AudioContext from the centralized audio bus.
 * All radio audio routes through the bus for volume/FX control.
 */
function getAudioContext(): AudioContext {
  return getRadioAudioContext();
}

/** Check if the user has muted sounds via the MenuBar toggle. */
function isSoundEnabled(): boolean {
  return localStorage.getItem('rmpg-sound') !== 'false';
}

// ─── Tone Definitions ───────────────────────────────────────

interface RadioToneStep {
  freq: number;                          // Start frequency (Hz)
  freqEnd?: number;                      // End frequency for sweep (Hz)
  ramp?: 'linear' | 'exponential';       // Sweep type (default: linear)
  type?: OscillatorType;                 // Per-step override (default: profile type)
  start: number;                         // Offset in seconds from tone start
  dur: number;                           // Duration of this step in seconds
}

/** MDC-1200 FSK burst definition — single oscillator with scheduled freqs */
interface FskBurst {
  freqA: number;       // Mark frequency (Hz) — typically 1200
  freqB: number;       // Space frequency (Hz) — typically 1800
  bitDuration: number; // Duration of each bit (seconds)
  totalBits: number;   // Total number of bits in burst
  start: number;       // Offset from tone start (seconds)
}

interface RadioToneProfile {
  type: OscillatorType;
  gain: number;
  steps?: RadioToneStep[];
  fsk?: FskBurst;        // MDC-1200 style FSK burst (alternative to steps)
  bandpass?: boolean;     // Apply radio-speaker bandpass filter (default: true)
  noise?: {              // White noise burst (for squelch effects)
    start: number;
    dur: number;
    gain: number;
    filterFreq?: number; // Bandpass center freq for noise shaping
    filterQ?: number;
  };
}

// ─── Motorola APX Tone Profiles ─────────────────────────────

const PROFILES: Record<RadioToneType, RadioToneProfile> = {

  // ── Talk Permit Tone: 1050Hz pip, ~40ms
  // The classic Motorola "bip" — repeater grants TX permission.
  // Short, clean, unmistakable.
  pttChirp: {
    type: 'sine',
    gain: 0.30,
    steps: [
      { freq: 1050, start: 0, dur: 0.04 },
    ],
  },

  // ── MDC-1200 PTT-ID / Roger Beep
  // Rapid FSK burst alternating 1200Hz ↔ 1800Hz — THE Motorola sound.
  // 10 bits × 18ms = 180ms of characteristic "brrrt" data burst.
  // Uses a single oscillator with setValueAtTime() for continuous-phase
  // FSK — no clicking between segments.
  rogerBeep: {
    type: 'sine',
    gain: 0.25,
    fsk: {
      freqA: 1200,
      freqB: 1800,
      bitDuration: 0.018,
      totalBits: 10,
      start: 0,
    },
  },

  // ── Receive Start: Ascending double-pip (940Hz + 1050Hz)
  // Quick two-tone indicating an incoming transmission from the channel.
  receiveStart: {
    type: 'sine',
    gain: 0.22,
    steps: [
      { freq: 940,  start: 0,     dur: 0.035 },
      { freq: 1050, start: 0.045, dur: 0.035 },
    ],
  },

  // ── Receive End: Quick descending sweep 1050→880Hz, 50ms
  // Marks the end of a remote transmission.
  receiveEnd: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 1050, freqEnd: 880, ramp: 'linear', start: 0, dur: 0.05 },
    ],
  },

  // ── Channel/Zone Change: Double confirmation beep at 1050Hz
  // Standard Motorola channel-switch acknowledgment.
  channelChange: {
    type: 'sine',
    gain: 0.25,
    steps: [
      { freq: 1050, start: 0,    dur: 0.05 },
      { freq: 1050, start: 0.08, dur: 0.05 },
    ],
  },

  // ── Channel Deny / Bonk: Low square-wave double-buzz
  // Harsh, attention-getting tone when TX is blocked.
  channelDeny: {
    type: 'square',
    gain: 0.10,
    steps: [
      { freq: 340, start: 0,    dur: 0.07 },
      { freq: 340, start: 0.10, dur: 0.07 },
    ],
  },

  // ── Squelch Open: Brief white noise burst simulating FM squelch gate
  // The characteristic "shhhk" static pop when a radio receives a signal.
  // Bandpass filtered at 2000Hz to give it that tinny radio-speaker quality.
  squelchOpen: {
    type: 'sine', // Not used — noise generator replaces oscillator
    gain: 0.12,
    noise: {
      start: 0,
      dur: 0.08,
      gain: 0.12,
      filterFreq: 2000,
      filterQ: 1.2,
    },
  },

  // ── Squelch Close / Squelch Tail: "Kerchunk" static burst on TX end
  // Slightly longer and lower-pitched than squelch open — the distinctive
  // sound of a radio signal dropping off. Bandpass at 1200Hz for that
  // "thud" quality.
  squelchClose: {
    type: 'sine',
    gain: 0.10,
    noise: {
      start: 0,
      dur: 0.12,
      gain: 0.10,
      filterFreq: 1200,
      filterQ: 1.5,
    },
  },

  // ── Emergency Alert: Motorola standard alternating 1545Hz/2175Hz warble
  // Plays 4 cycles of the two-tone alternation — used for emergency activations.
  // Each tone is 250ms with no gap — creates the recognizable warbling alert.
  emergency: {
    type: 'sine',
    gain: 0.35,
    bandpass: false, // Full-range for maximum attention
    steps: [
      { freq: 1545, start: 0.00,  dur: 0.25 },
      { freq: 2175, start: 0.25,  dur: 0.25 },
      { freq: 1545, start: 0.50,  dur: 0.25 },
      { freq: 2175, start: 0.75,  dur: 0.25 },
      { freq: 1545, start: 1.00,  dur: 0.25 },
      { freq: 2175, start: 1.25,  dur: 0.25 },
      { freq: 1545, start: 1.50,  dur: 0.25 },
      { freq: 2175, start: 1.75,  dur: 0.25 },
    ],
  },

  // ── Low Battery: Triple descending beep
  // Standard Motorola low-battery warning: 1050, 940, 830Hz triple pip.
  lowBattery: {
    type: 'sine',
    gain: 0.18,
    steps: [
      { freq: 1050, start: 0,    dur: 0.06 },
      { freq: 940,  start: 0.10, dur: 0.06 },
      { freq: 830,  start: 0.20, dur: 0.06 },
    ],
  },

  // ── Scanner Lock-on: Quick high pip when scanner stops on activity
  scanHit: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 1200, start: 0, dur: 0.025 },
    ],
  },

  // ════════════════════════════════════════════════════════
  // Phase 3 — Additional Tone Profiles
  // ════════════════════════════════════════════════════════

  // ── Two-Tone Paging: Sequential dual-tone for unit alerting
  // Tone A (1000Hz, 1s) + 50ms gap + Tone B (2000Hz, 3s).
  // Standard fire/EMS paging format.
  twoTonePage: {
    type: 'sine',
    gain: 0.30,
    steps: [
      { freq: 1000, start: 0,    dur: 1.0 },
      { freq: 2000, start: 1.05, dur: 3.0 },
    ],
  },

  // ── MDC-1200 Data Burst: Extended FSK packet
  // 40-bit preamble+data at 1200 baud — longer than the roger beep.
  // Represents a full MDC-1200 data transmission.
  mdcDataBurst: {
    type: 'sine',
    gain: 0.22,
    fsk: {
      freqA: 1200,
      freqB: 1800,
      bitDuration: 0.0083,  // 1200 baud
      totalBits: 40,
      start: 0,
    },
  },

  // ── Priority Alert: Triple pip + sustained high tone
  // Distinct from emergency warble — used for priority dispatches.
  priorityAlert: {
    type: 'sine',
    gain: 0.35,
    steps: [
      { freq: 1050, start: 0,    dur: 0.15 },
      { freq: 1050, start: 0.20, dur: 0.15 },
      { freq: 1050, start: 0.40, dur: 0.15 },
      { freq: 1500, start: 0.60, dur: 0.30 },
    ],
  },

  // ── Radio Check: Triple 1050Hz pips
  // Sent when requesting a radio check from other units.
  radioCheck: {
    type: 'sine',
    gain: 0.25,
    steps: [
      { freq: 1050, start: 0,    dur: 0.08 },
      { freq: 1050, start: 0.12, dur: 0.08 },
      { freq: 1050, start: 0.24, dur: 0.08 },
    ],
  },

  // ── Radio Check ACK: Quick ascending double-pip
  // Confirmation that the radio check was received.
  radioCheckAck: {
    type: 'sine',
    gain: 0.20,
    steps: [
      { freq: 1050, start: 0,    dur: 0.05 },
      { freq: 1200, start: 0.07, dur: 0.05 },
    ],
  },

  // ── Selcall Alert: Alternating 1000/2000Hz two-tone alert
  // Used for selective calling — plays once per invocation.
  // Loop it via playLoopingTone() for persistent alerting.
  selcallAlert: {
    type: 'sine',
    gain: 0.35,
    bandpass: false,
    steps: [
      { freq: 1000, start: 0,    dur: 0.50 },
      { freq: 2000, start: 0.55, dur: 0.50 },
      { freq: 1000, start: 1.10, dur: 0.50 },
      { freq: 2000, start: 1.65, dur: 0.50 },
    ],
  },
};

// ─── Audio Rendering ────────────────────────────────────────

/** 1.5ms fade — abrupt like real radio hardware (prevents clicks, not soft) */
const FADE_S = 0.0015;

/**
 * Bandpass filter simulating radio speaker character.
 * Centered at 1400Hz with moderate Q — gives tones that slightly
 * compressed, band-limited quality of real radio audio output.
 */
function createRadioBandpass(ctx: AudioContext): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1400;
  filter.Q.value = 0.8;
  return filter;
}

/**
 * Create a white noise buffer for squelch static effects.
 * Uses a pre-generated buffer of random samples.
 */
function createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const numSamples = Math.ceil(sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < numSamples; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Render an MDC-1200 FSK burst on a SINGLE oscillator with scheduled
 * frequency changes. Real MDC-1200 is continuous-phase FSK — the
 * oscillator never stops, it just snaps between mark (1200Hz) and
 * space (1800Hz) frequencies. Using setValueAtTime() replicates this
 * exactly, with no inter-bit clicking or phase discontinuities.
 */
function renderFskBurst(
  ctx: AudioContext,
  fsk: FskBurst,
  output: AudioNode,
  startTime: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = 'sine';

  // Schedule rapid frequency alternation (FSK encoding)
  const burstStart = startTime + fsk.start;
  for (let i = 0; i < fsk.totalBits; i++) {
    const freq = i % 2 === 0 ? fsk.freqA : fsk.freqB;
    osc.frequency.setValueAtTime(freq, burstStart + i * fsk.bitDuration);
  }

  // Abrupt gain envelope — real MDC bursts snap on/off
  const env = ctx.createGain();
  const totalDur = fsk.totalBits * fsk.bitDuration;
  env.gain.setValueAtTime(0, burstStart);
  env.gain.linearRampToValueAtTime(1, burstStart + FADE_S);
  env.gain.setValueAtTime(1, burstStart + totalDur - FADE_S);
  env.gain.linearRampToValueAtTime(0, burstStart + totalDur);

  osc.connect(env);
  env.connect(output);

  osc.start(burstStart);
  osc.stop(burstStart + totalDur + 0.01);

  return osc;
}

/**
 * Render a white noise burst — used for squelch open/close effects.
 * Noise is bandpass-filtered to give it realistic radio character.
 */
function renderNoiseBurst(
  ctx: AudioContext,
  noise: NonNullable<RadioToneProfile['noise']>,
  output: AudioNode,
  startTime: number,
): AudioBufferSourceNode {
  const buffer = createNoiseBuffer(ctx, noise.dur + 0.05);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Bandpass filter for radio speaker character
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = noise.filterFreq || 2000;
  filter.Q.value = noise.filterQ || 1.0;

  // Gain envelope — quick fade in, abrupt fade out (like real squelch)
  const env = ctx.createGain();
  const burstStart = startTime + noise.start;
  env.gain.setValueAtTime(0, burstStart);
  env.gain.linearRampToValueAtTime(noise.gain, burstStart + 0.003); // 3ms attack
  env.gain.setValueAtTime(noise.gain, burstStart + noise.dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.001, burstStart + noise.dur); // Quick decay

  source.connect(filter);
  filter.connect(env);
  env.connect(output);

  source.start(burstStart);
  source.stop(burstStart + noise.dur + 0.01);

  return source;
}

/**
 * Play a radio tone effect.
 * Returns a handle to stop the tone early, or null if sound is muted.
 */
export function playRadioTone(tone: RadioToneType): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;

  try {
    const ctx = getAudioContext();
    const profile = PROFILES[tone];
    const now = ctx.currentTime;

    // Master gain node for this tone
    const masterGain = ctx.createGain();
    masterGain.gain.value = profile.gain;

    // Route through centralized audio bus (provides master volume, FX, VU metering)
    const bus = getRadioAudioBus();
    const busInput = bus.getInputNode();

    // Bandpass filter for radio speaker character (default: on)
    if (profile.bandpass !== false) {
      const filter = createRadioBandpass(ctx);
      masterGain.connect(filter);
      filter.connect(busInput);
    } else {
      masterGain.connect(busInput);
    }

    const oscillators: OscillatorNode[] = [];
    const sources: AudioBufferSourceNode[] = [];

    // ── Render noise burst (squelch effects) ──
    if (profile.noise) {
      const src = renderNoiseBurst(ctx, profile.noise, masterGain, now);
      sources.push(src);
    }

    // ── Render FSK burst (MDC-1200 roger beep) ──
    if (profile.fsk) {
      const osc = renderFskBurst(ctx, profile.fsk, masterGain, now);
      oscillators.push(osc);
    }

    // ── Render step-based tones ──
    if (profile.steps) {
      for (const step of profile.steps) {
        const osc = ctx.createOscillator();
        osc.type = step.type || profile.type;
        osc.frequency.setValueAtTime(step.freq, now + step.start);

        // Frequency sweep if specified
        if (step.freqEnd !== undefined && step.freqEnd !== step.freq) {
          const endTime = now + step.start + step.dur;
          if (step.ramp === 'exponential' && step.freqEnd > 0) {
            osc.frequency.exponentialRampToValueAtTime(step.freqEnd, endTime);
          } else {
            osc.frequency.linearRampToValueAtTime(step.freqEnd, endTime);
          }
        }

        // Abrupt gain envelope — 1.5ms fade, like real radio hardware
        const stepGain = ctx.createGain();
        const fade = Math.min(FADE_S, step.dur / 4);
        stepGain.gain.setValueAtTime(0, now + step.start);
        stepGain.gain.linearRampToValueAtTime(1, now + step.start + fade);
        stepGain.gain.setValueAtTime(1, now + step.start + step.dur - fade);
        stepGain.gain.linearRampToValueAtTime(0, now + step.start + step.dur);

        osc.connect(stepGain);
        stepGain.connect(masterGain);

        osc.start(now + step.start);
        osc.stop(now + step.start + step.dur + 0.01);
        oscillators.push(osc);
      }
    }

    return {
      stop: () => {
        try {
          masterGain.gain.setValueAtTime(0, ctx.currentTime);
          for (const osc of oscillators) {
            try { osc.stop(); } catch { /* already stopped */ }
          }
          for (const src of sources) {
            try { src.stop(); } catch { /* already stopped */ }
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
 * Play a radio tone and return a promise that resolves when the tone completes.
 * Critical for PTT chirp — must finish before mic opens to prevent feedback.
 */
export function playRadioToneAsync(tone: RadioToneType): Promise<void> {
  const profile = PROFILES[tone];

  let totalDuration = 0;
  if (profile.fsk) {
    totalDuration = Math.max(totalDuration,
      profile.fsk.start + profile.fsk.totalBits * profile.fsk.bitDuration);
  }
  if (profile.steps) {
    for (const s of profile.steps) {
      totalDuration = Math.max(totalDuration, s.start + s.dur);
    }
  }
  if (profile.noise) {
    totalDuration = Math.max(totalDuration, profile.noise.start + profile.noise.dur);
  }

  playRadioTone(tone);
  return new Promise(resolve => setTimeout(resolve, totalDuration * 1000 + 30));
}

/** Radio static controller interface — enhanced with crackle events */
export interface RadioStaticController {
  start(): void;
  stop(): void;
  setVolume(v: number): void;
  getVolume(): number;
  destroy(): void;
}

/**
 * Create a continuous low-level static hiss for background radio ambience.
 * Enhanced with:
 *   - Layered noise (broadband + low-frequency rumble)
 *   - Random crackle/pop events simulating atmospheric interference
 *   - Routes through centralized audio bus for volume/FX control
 */
export function createRadioStatic(): RadioStaticController {
  let ctx: AudioContext | null = null;
  let whiteSource: AudioBufferSourceNode | null = null;
  let brownSource: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let isRunning = false;
  let crackleTimer: ReturnType<typeof setTimeout> | null = null;
  let currentVolume = 0.015;

  /** Schedule a random crackle/pop event */
  function scheduleCrackle(): void {
    if (!isRunning || !ctx || !gainNode) return;
    // Random interval: 2-8 seconds
    const delay = 2000 + Math.random() * 6000;
    crackleTimer = setTimeout(() => {
      if (!isRunning || !ctx || !gainNode) return;
      try {
        const bus = getRadioAudioBus();
        // Short noise pop: 5-20ms, random bandpass center (800-2500Hz)
        const popDur = 0.005 + Math.random() * 0.015;
        const popFreq = 800 + Math.random() * 1700;
        const popBuffer = createNoiseBuffer(ctx, popDur + 0.01);
        const popSource = ctx.createBufferSource();
        popSource.buffer = popBuffer;

        const popFilter = ctx.createBiquadFilter();
        popFilter.type = 'bandpass';
        popFilter.frequency.value = popFreq;
        popFilter.Q.value = 1.5 + Math.random();

        const popGain = ctx.createGain();
        const popLevel = currentVolume * (1.5 + Math.random() * 2);
        const now = ctx.currentTime;
        popGain.gain.setValueAtTime(0, now);
        popGain.gain.linearRampToValueAtTime(popLevel, now + 0.001);
        popGain.gain.setValueAtTime(popLevel, now + popDur * 0.5);
        popGain.gain.exponentialRampToValueAtTime(0.001, now + popDur);

        popSource.connect(popFilter);
        popFilter.connect(popGain);
        popGain.connect(bus.getInputNode());
        popSource.start(now);
        popSource.stop(now + popDur + 0.01);
      } catch { /* crackle is best-effort */ }

      // Schedule next crackle
      scheduleCrackle();
    }, delay);
  }

  return {
    start(): void {
      if (isRunning) return;
      try {
        ctx = getAudioContext();
        const bus = getRadioAudioBus();

        // ── Layer 1: Broadband white noise (primary hiss) ──
        const whiteBuffer = createNoiseBuffer(ctx, 2);
        whiteSource = ctx.createBufferSource();
        whiteSource.buffer = whiteBuffer;
        whiteSource.loop = true;

        const whiteFilter = ctx.createBiquadFilter();
        whiteFilter.type = 'bandpass';
        whiteFilter.frequency.value = 1800;
        whiteFilter.Q.value = 2.0;

        const whiteGain = ctx.createGain();
        whiteGain.gain.value = 0.8; // 80% of mix

        // ── Layer 2: Brown noise (low-frequency rumble) ──
        const brownBuffer = createNoiseBuffer(ctx, 2);
        brownSource = ctx.createBufferSource();
        brownSource.buffer = brownBuffer;
        brownSource.loop = true;

        const brownFilter = ctx.createBiquadFilter();
        brownFilter.type = 'lowpass';
        brownFilter.frequency.value = 400;
        brownFilter.Q.value = 0.5;

        const brownGain = ctx.createGain();
        brownGain.gain.value = 0.2; // 20% of mix

        // ── Mix to output ──
        gainNode = ctx.createGain();
        gainNode.gain.value = currentVolume;

        whiteSource.connect(whiteFilter);
        whiteFilter.connect(whiteGain);
        whiteGain.connect(gainNode);

        brownSource.connect(brownFilter);
        brownFilter.connect(brownGain);
        brownGain.connect(gainNode);

        // Route through centralized audio bus
        gainNode.connect(bus.getInputNode());

        whiteSource.start();
        brownSource.start();
        isRunning = true;

        // Start random crackle events
        scheduleCrackle();
      } catch { /* audio not available */ }
    },

    stop(): void {
      if (!isRunning) return;
      // Cancel crackle timer
      if (crackleTimer) {
        clearTimeout(crackleTimer);
        crackleTimer = null;
      }
      try {
        if (gainNode && ctx) {
          const now = ctx.currentTime;
          gainNode.gain.setValueAtTime(gainNode.gain.value, now);
          gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        }
        setTimeout(() => {
          try { whiteSource?.stop(); } catch { /* ok */ }
          try { brownSource?.stop(); } catch { /* ok */ }
          whiteSource = null;
          brownSource = null;
          gainNode = null;
          isRunning = false;
        }, 60);
      } catch {
        isRunning = false;
      }
    },

    setVolume(v: number): void {
      currentVolume = Math.max(0, Math.min(0.15, v));
      if (gainNode && ctx) {
        gainNode.gain.setValueAtTime(currentVolume, ctx.currentTime);
      }
    },

    getVolume(): number {
      return currentVolume;
    },

    destroy(): void {
      this.stop();
    },
  };
}

// ─── DTMF Tone Playback ────────────────────────────────────

/** Standard telephony DTMF frequency pairs (row freq + column freq) */
const DTMF_FREQS: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

/**
 * Play a DTMF tone for a given digit (0-9, *, #).
 * DTMF requires two simultaneous sine waves at specific frequencies.
 */
export function playDtmfTone(digit: string, durationMs: number = 120): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;
  const freqs = DTMF_FREQS[digit];
  if (!freqs) return null;

  try {
    const ctx = getAudioContext();
    const bus = getRadioAudioBus();
    const now = ctx.currentTime;
    const dur = durationMs / 1000;

    // Master gain for this DTMF tone
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    gain.connect(bus.getInputNode());

    // Two sine oscillators — one for row freq, one for column freq
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freqs[0];

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freqs[1];

    // Individual gain nodes (each at 0.5 to sum to ~1.0)
    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;

    osc1.connect(g1);
    g1.connect(gain);
    osc2.connect(g2);
    g2.connect(gain);

    // Envelope: quick fade in/out to prevent clicking
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.002);
    gain.gain.setValueAtTime(0.25, now + dur - 0.002);
    gain.gain.linearRampToValueAtTime(0, now + dur);

    osc1.start(now);
    osc1.stop(now + dur + 0.01);
    osc2.start(now);
    osc2.stop(now + dur + 0.01);

    return {
      stop: () => {
        try {
          gain.gain.setValueAtTime(0, ctx.currentTime);
          osc1.stop();
          osc2.stop();
        } catch { /* already stopped */ }
      },
    };
  } catch {
    return null;
  }
}

// ─── Looping Tone Playback ─────────────────────────────────

/**
 * Play a tone profile on repeat until stopped.
 * Re-schedules the tone every `intervalMs` milliseconds.
 * Used for selcall persistent alert and emergency continuous warble.
 */
export function playLoopingTone(
  tone: RadioToneType,
  intervalMs: number = 2500,
): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;

  let timer: ReturnType<typeof setInterval> | null = null;
  let currentHandle: { stop: () => void } | null = null;
  let stopped = false;

  const play = () => {
    if (stopped) return;
    currentHandle = playRadioTone(tone);
  };

  // Play immediately, then repeat
  play();
  timer = setInterval(play, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      currentHandle?.stop();
      currentHandle = null;
    },
  };
}

export type { RadioToneType };
