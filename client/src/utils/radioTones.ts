// ============================================================
// RMPG Flex — Motorola APX Emergency Services Radio Tones
//
// Authentic Motorola APX 6000/8000 radio tones via Web Audio API.
//
// Real radio audio character comes from three things:
//   1. NARROW bandpass (Q ~2.5) simulating the tiny 36mm speaker
//   2. Subtle waveshaper distortion — codec artifacts + amp clipping
//   3. Correct timing — APX talk-permit is ~90ms, not a short click
//
// • MDC-1200 FSK burst for roger beep (1200/1800Hz continuous-phase
//   FSK, 1200 baud, same as real Motorola MDC signaling)
// • 800Hz triple-beep talk-permit (real APX P25 channel grant)
// • 1.5ms attack/decay — abrupt like real radio hardware
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
  | 'panicWarble'    // Emergency warble (960/1500Hz alternating, 3 seconds)
  | 'keyUpTone'      // Quick acknowledgment when channel clears
  | 'batteryLow'     // Triple descending beep warning
  | 'outOfRange';    // Low-frequency triple buzz — signal loss

let audioCtx: AudioContext | null = null;

/** Lazy-init a shared AudioContext (browser requires user gesture). */
function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
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
  totalBits: number;   // Fallback count if no pattern provided
  pattern?: number[];  // Custom bit pattern: 0=freqA, 1=freqB. Overrides totalBits.
  start: number;       // Offset from tone start (seconds)
}

interface RadioToneProfile {
  type: OscillatorType;
  gain: number;
  steps?: RadioToneStep[];
  fsk?: FskBurst;        // MDC-1200 style FSK burst (alternative to steps)
  bandpass?: boolean;     // Apply radio-speaker bandpass filter (default: true)
}

// ─── Motorola APX Tone Profiles ─────────────────────────────

const PROFILES: Record<RadioToneType, RadioToneProfile> = {

  // ── Talk Permit Tone: THREE quick beeps at 800Hz
  // The real Motorola APX talk-permit on P25 trunked systems.
  // Three rapid chirps at 800Hz — the channel grant confirmation
  // everyone recognizes from Motorola radios. ~35ms per beep with
  // ~25ms gaps between them.
  pttChirp: {
    type: 'sine',
    gain: 0.55,
    steps: [
      { freq: 800, start: 0,     dur: 0.035 },
      { freq: 800, start: 0.060, dur: 0.035 },
      { freq: 800, start: 0.120, dur: 0.035 },
    ],
  },

  // ── MDC-1200 PTT-ID / Roger Beep
  // Real MDC-1200 packet at 1200 baud FSK (1200Hz mark / 1800Hz space).
  // The characteristic "brrrt-chirp" sound comes from the packet structure:
  //   Preamble (alternating 1/0) → steady warble
  //   Sync word (0x07092A)       → pattern break (the "chirp")
  //   Data (PTT-ID + unit)       → irregular data burst
  //   CRC                        → checksum bits
  // Total: 88 bits at 1200 baud = ~73ms
  rogerBeep: {
    type: 'sine',
    gain: 0.48,
    fsk: {
      freqA: 1200,
      freqB: 1800,
      bitDuration: 0.000833,  // 1200 baud — actual MDC-1200 rate
      totalBits: 88,
      // Real MDC-1200 packet structure encoded as bit pattern:
      pattern: [
        // Preamble — 32 bits alternating (the recognizable steady warble)
        1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0,
        1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0,
        // Sync word 0x07092A (frame synchronization — breaks the warble)
        0,0,0,0,0,1,1,1, 0,0,0,0,1,0,0,1, 0,0,1,0,1,0,1,0,
        // Data: op=0x01 (PTT-ID) + unit=0x34
        0,0,0,0,0,0,0,1, 0,0,1,1,0,1,0,0,
        // CRC-CCITT checksum
        1,1,0,0,0,1,0,1,
      ],
      start: 0,
    },
  },

  // ── Receive Start: Ascending double-pip (940Hz + 1050Hz)
  // Quick two-tone indicating an incoming transmission from the channel.
  // Snappy 40ms pips with tight gap — mimics the real APX squelch-open indicator.
  receiveStart: {
    type: 'sine',
    gain: 0.42,
    steps: [
      { freq: 940,  start: 0,     dur: 0.040 },
      { freq: 1050, start: 0.050, dur: 0.040 },
    ],
  },

  // ── Receive End: Quick descending sweep 1050→880Hz, 60ms
  // Marks the end of a remote transmission. Slightly longer than original
  // for audible pitch drop through the bandpass.
  receiveEnd: {
    type: 'sine',
    gain: 0.38,
    steps: [
      { freq: 1050, freqEnd: 880, ramp: 'linear', start: 0, dur: 0.060 },
    ],
  },

  // ── Channel/Zone Change: Double confirmation beep at 1050Hz
  // Standard Motorola channel-switch acknowledgment. 60ms pips — needs
  // to be clearly audible as TWO distinct beeps.
  channelChange: {
    type: 'sine',
    gain: 0.45,
    steps: [
      { freq: 1050, start: 0,    dur: 0.060 },
      { freq: 1050, start: 0.09, dur: 0.060 },
    ],
  },

  // ── Channel Deny / Bonk: Low square-wave double-buzz
  // Harsh, attention-getting tone when TX is blocked. The square wave
  // through the bandpass + waveshaper gives a raspy, unmistakable buzz.
  channelDeny: {
    type: 'square',
    gain: 0.22,
    steps: [
      { freq: 340, start: 0,    dur: 0.080 },
      { freq: 340, start: 0.12, dur: 0.080 },
    ],
  },

  // ── Emergency Warble: Alternating 960Hz/1500Hz, 3 seconds
  // Authentic Motorola APX emergency alert tone. Fast two-tone warble
  // cycling 12 times at 250ms intervals. Full-range audio (no bandpass)
  // for maximum audibility — cuts through any ambient noise. LOUD.
  panicWarble: {
    type: 'sine',
    gain: 0.60,
    bandpass: false,
    steps: [
      { freq: 960,  start: 0.00, dur: 0.24 },
      { freq: 1500, start: 0.25, dur: 0.24 },
      { freq: 960,  start: 0.50, dur: 0.24 },
      { freq: 1500, start: 0.75, dur: 0.24 },
      { freq: 960,  start: 1.00, dur: 0.24 },
      { freq: 1500, start: 1.25, dur: 0.24 },
      { freq: 960,  start: 1.50, dur: 0.24 },
      { freq: 1500, start: 1.75, dur: 0.24 },
      { freq: 960,  start: 2.00, dur: 0.24 },
      { freq: 1500, start: 2.25, dur: 0.24 },
      { freq: 960,  start: 2.50, dur: 0.24 },
      { freq: 1500, start: 2.75, dur: 0.24 },
    ],
  },

  // ── Key-Up Tone: Quick 880Hz pip when channel clears
  // Brief acknowledgment after someone else finishes transmitting.
  // Short but audible — 45ms is the sweet spot for a crisp pip.
  keyUpTone: {
    type: 'sine',
    gain: 0.35,
    steps: [
      { freq: 880, start: 0, dur: 0.045 },
    ],
  },

  // ── Battery Low: Triple descending beep warning
  // Three tones stepping down in pitch — universal "something's wrong"
  // pattern. Longer pips (100ms) so the descending pitch is clearly heard.
  batteryLow: {
    type: 'sine',
    gain: 0.40,
    steps: [
      { freq: 1050, start: 0,    dur: 0.100 },
      { freq: 880,  start: 0.14, dur: 0.100 },
      { freq: 660,  start: 0.28, dur: 0.100 },
    ],
  },

  // ── Out of Range: Low-frequency triple buzz
  // Square-wave buzz at 280Hz — harsh, unmistakable "no signal" alert.
  // Plays when WebSocket connection is lost. Needs to sound BAD — like
  // something is wrong with the radio.
  outOfRange: {
    type: 'square',
    gain: 0.18,
    steps: [
      { freq: 280, start: 0,    dur: 0.18 },
      { freq: 280, start: 0.28, dur: 0.18 },
      { freq: 280, start: 0.56, dur: 0.18 },
    ],
  },
};

// ─── Audio Rendering ────────────────────────────────────────

/** 1.5ms fade — abrupt like real radio hardware (prevents clicks, not soft) */
const FADE_S = 0.0015;

/**
 * Bandpass filter simulating the narrow audio response of a Motorola APX
 * 36mm internal speaker. Real radio speakers have a tight resonant peak
 * around 1.2-1.6kHz — everything outside that range drops off hard.
 *
 * Q=2.5 gives the "boxy", band-limited character you hear from real radios.
 * (Previous Q=0.8 was essentially no filtering — sounded like raw synth.)
 */
function createRadioBandpass(ctx: AudioContext): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1350;
  filter.Q.value = 2.5;
  return filter;
}

/**
 * Subtle waveshaper distortion simulating radio codec artifacts + speaker
 * clipping. Real P25 IMBE/AMBE vocoders add slight harmonic distortion,
 * and the small speaker amp soft-clips at higher volumes.
 *
 * This curve adds ~5-8% harmonic content — enough to sound "radio-like"
 * without being obviously distorted.
 */
function createRadioDistortion(ctx: AudioContext): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1; // -1 to +1
    // Soft-clip transfer function: tanh-like curve with slight asymmetry
    // This mimics the nonlinear response of a small radio speaker
    curve[i] = Math.tanh(x * 1.4) * 0.95 + x * 0.05;
  }
  shaper.curve = curve;
  shaper.oversample = '2x'; // Reduce aliasing artifacts
  return shaper;
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

  const burstStart = startTime + fsk.start;
  const bitCount = fsk.pattern ? fsk.pattern.length : fsk.totalBits;

  // Schedule frequency per bit — either from custom pattern or alternating
  for (let i = 0; i < bitCount; i++) {
    let freq: number;
    if (fsk.pattern) {
      // Custom bit pattern: 0 = freqA (mark/1200Hz), 1 = freqB (space/1800Hz)
      freq = fsk.pattern[i] === 0 ? fsk.freqA : fsk.freqB;
    } else {
      // Default: simple alternation
      freq = i % 2 === 0 ? fsk.freqA : fsk.freqB;
    }
    osc.frequency.setValueAtTime(freq, burstStart + i * fsk.bitDuration);
  }

  // Abrupt gain envelope — real MDC bursts snap on/off
  const env = ctx.createGain();
  const totalDur = bitCount * fsk.bitDuration;
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
 * Play a radio tone effect.
 * Returns a handle to stop the tone early, or null if sound is muted.
 */
export function playRadioTone(tone: RadioToneType): { stop: () => void } | null {
  if (!isSoundEnabled()) return null;

  try {
    const ctx = getAudioContext();
    const profile = PROFILES[tone];
    const now = ctx.currentTime;

    // Master gain node
    const masterGain = ctx.createGain();
    masterGain.gain.value = profile.gain;

    // Radio speaker processing chain: gain → distortion → bandpass → output
    // This combo gives the authentic "coming through a Motorola radio" sound.
    // Panic warble bypasses this chain for maximum raw audibility.
    if (profile.bandpass !== false) {
      const distortion = createRadioDistortion(ctx);
      const filter = createRadioBandpass(ctx);
      masterGain.connect(distortion);
      distortion.connect(filter);
      filter.connect(ctx.destination);
    } else {
      masterGain.connect(ctx.destination);
    }

    const oscillators: OscillatorNode[] = [];

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
    const bitCount = profile.fsk.pattern ? profile.fsk.pattern.length : profile.fsk.totalBits;
    totalDuration = Math.max(totalDuration,
      profile.fsk.start + bitCount * profile.fsk.bitDuration);
  }
  if (profile.steps) {
    for (const s of profile.steps) {
      totalDuration = Math.max(totalDuration, s.start + s.dur);
    }
  }

  playRadioTone(tone);
  return new Promise(resolve => setTimeout(resolve, totalDuration * 1000 + 30));
}

export type { RadioToneType };
