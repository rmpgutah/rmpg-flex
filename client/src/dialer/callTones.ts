// ============================================================
// RMPG Flex — Softphone call-progress tones
// ============================================================
// Two looping tones the dispatcher hears on the telephony path:
//
//   'ring'     — an INBOUND call is alerting. Deliberately faster than the
//                PSTN standard (1.5 s on / 2 s off) so it reads as "answer
//                me" across a console room rather than as a phone ringing
//                somewhere in the building.
//   'ringback' — an OUTBOUND call's far end is ringing. Standard North
//                American ringback cadence (2 s on / 4 s off), because a
//                dispatcher judges "is it still ringing?" against the
//                cadence they know from every other phone.
//
// Both are the classic 440 Hz + 480 Hz precise-tone pair, synthesized rather
// than sampled: no asset fetch, no CSP headroom, and it starts on the same
// tick the call state changes (a sample that arrives 300 ms late reads as a
// missed ring).
//
// ⚠️ These are CALL-PROGRESS tones, not CAD alert tones. They deliberately do
// NOT route through dispatchTones.ts's Motorola sound library: that library
// is a one-shot player keyed to CAD severity, and these need to loop for the
// life of a ringing call and stop on the exact tick it is answered. They do
// honour the same global mute (`rmpg-sound`) so "silence the console" still
// means silence.
//
// Browsers require a user gesture before an AudioContext may emit sound. A
// dispatcher has invariably clicked something before a call arrives, but the
// very first ring after a cold page load can be silent — a browser-level
// restriction with no workaround. IncomingCallToast still shows on screen.
// ============================================================

export type CallToneMode = 'ring' | 'ringback';

/** Cadence period (one on+off cycle) for an alerting inbound call. */
export const RING_PERIOD_MS = 3_500;
/** Cadence period for the outbound ringback — the standard 2-on/4-off. */
export const RINGBACK_PERIOD_MS = 6_000;

const RING_ON_MS = 1_500;
const RINGBACK_ON_MS = 2_000;

/** The precise-tone pair every North American ring/ringback is built from. */
const TONE_HZ = [440, 480] as const;
/** Peak gain per burst. Two oscillators sum, so each sits well under unity. */
const PEAK_GAIN = 0.12;
const RAMP_MS = 40;

const ENABLED_KEY = 'rmpg_call_tones';
const GLOBAL_MUTE_KEY = 'rmpg-sound';

interface Cadence {
  mode: CallToneMode;
  timer: ReturnType<typeof setInterval>;
}

let ctx: AudioContext | null = null;
let cadence: Cadence | null = null;
/** Nodes belonging to the burst currently sounding, so it can be cut short. */
let burst: { stop(): void } | null = null;

/** Per-dispatcher toggle. Defaults ON — a silent softphone is a missed call. */
export function isCallToneEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setCallToneEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // localStorage quota / private mode — the tone just isn't remembered.
  }
}

function audible(): boolean {
  try {
    if (localStorage.getItem(GLOBAL_MUTE_KEY) === 'false') return false;
  } catch {
    // Unreadable storage is not a reason to silence a ringing phone.
  }
  return isCallToneEnabled();
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (typeof Ctor !== 'function') return null;
  if (!ctx || ctx.state === 'closed') {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // An AudioContext created before the first user gesture starts suspended and
  // stays silent until resumed; resuming is a no-op once it is running.
  if (ctx.state === 'suspended') void ctx.resume?.().catch(() => undefined);
  return ctx;
}

/** Schedule one on-period of the two-tone pair. Returns its teardown. */
function playBurst(onMs: number): { stop(): void } | null {
  const audio = getContext();
  if (!audio) return null;
  const now = audio.currentTime;
  const ramp = RAMP_MS / 1000;
  const end = now + onMs / 1000;

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + ramp);
  gain.gain.setValueAtTime(PEAK_GAIN, Math.max(now + ramp, end - ramp));
  gain.gain.linearRampToValueAtTime(0, end);
  gain.connect(audio.destination);

  const oscillators = TONE_HZ.map((hz) => {
    const osc = audio.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;
    osc.connect(gain);
    osc.start(now);
    osc.stop(end);
    return osc;
  });

  let torn = false;
  return {
    stop() {
      if (torn) return;
      torn = true;
      for (const osc of oscillators) {
        try { osc.stop(); } catch { /* already stopped at its scheduled end */ }
        try { osc.disconnect(); } catch { /* already detached */ }
      }
      try { gain.disconnect(); } catch { /* already detached */ }
    },
  };
}

function cutBurst(): void {
  burst?.stop();
  burst = null;
}

/**
 * Assert which call-progress tone should be sounding, or `null` for silence.
 * Idempotent: re-asserting the mode already playing leaves its cadence alone,
 * so a re-render mid-ring does not restart the ring from the top.
 */
export function setCallTone(mode: CallToneMode | null): void {
  if (!mode || !audible()) {
    stopCallTones();
    return;
  }
  if (cadence?.mode === mode) return;

  stopCallTones();
  const period = mode === 'ring' ? RING_PERIOD_MS : RINGBACK_PERIOD_MS;
  const onMs = mode === 'ring' ? RING_ON_MS : RINGBACK_ON_MS;

  const cycle = () => {
    cutBurst();
    burst = playBurst(onMs);
  };
  cycle(); // sound on the tick the call state changed, not one period later
  cadence = { mode, timer: setInterval(cycle, period) };
}

export function stopCallTones(): void {
  if (cadence) clearInterval(cadence.timer);
  cadence = null;
  cutBurst();
}

/**
 * Hard ceiling on how long ringback may play without the PSTN leg's status
 * stream saying the far end answered. Slightly beyond a typical carrier
 * no-answer timeout (30–45 s), so it only ever fires when the stream itself
 * has failed — never on a call that is genuinely still ringing.
 */
export const RINGBACK_MAX_MS = 60_000;
