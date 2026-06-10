// ============================================================
// RMPG Flex — Action Chimes (Spillman Flex console acknowledge)
// Short, dry terminal "data acknowledge" tones played when a
// mutating API call succeeds — the Spillman/Motorola console
// idiom of an audible ACK on every transaction commit:
//   submit (POST)        — two quick ascending data blips
//   update (PUT/PATCH)   — single mid blip with a short confirm
//   delete (DELETE)      — single low descending blip
// Synthesized with WebAudio (no assets, offline-safe), voiced
// like startupSound.ts/uiClickSounds.ts: square-ish oscillators
// through a lowpass for the utilitarian MDT character.
//
// Gates:
//  - per-unit silent/vibrate audio mode (audioMode.ts)
//  - user toggle in localStorage (rmpg_action_chimes, default ON)
//  - background-traffic exclusion (GPS breadcrumbs, heartbeats,
//    live-sync, telemetry) so 1Hz pollers don't turn the console
//    into a metronome
//  - 400ms throttle for burst mutations (multi-save loops)
// ============================================================
import { getLocalAudioMode } from './audioMode';
import { playSoundAsset } from './soundAssets';

export type ActionChimeKind = 'submit' | 'update' | 'delete';

const TOGGLE_KEY = 'rmpg_action_chimes';
const THROTTLE_MS = 400;

// Mutations that are machine traffic, not operator actions — never chime.
const BACKGROUND_PATHS = /\/(gps|heartbeat|activity|telemetry|live-sync|presence|ping|nav\/trip|trips\/breadcrumb|breadcrumbs|welfare|read-receipts?|seen|ack|token\/refresh|auth\/refresh|logs?\b)/i;

let ctx: AudioContext | null = null;
let lastChime = 0;

export function actionChimesEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch { return true; }
}

export function setActionChimesEnabled(on: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

interface Step { freq: number; at: number; dur: number; gain: number; type: OscillatorType }

// Spillman-style transaction-ACK voicings.
const SEQUENCES: Record<ActionChimeKind, Step[]> = {
  // POST — "entry accepted": two crisp ascending data blips
  submit: [
    { freq: 1046, at: 0.0, dur: 0.06, gain: 0.22, type: 'square' },
    { freq: 1568, at: 0.09, dur: 0.08, gain: 0.24, type: 'square' },
  ],
  // PUT/PATCH — "record updated": one mid blip + soft confirm a 4th up
  update: [
    { freq: 1175, at: 0.0, dur: 0.07, gain: 0.22, type: 'square' },
    { freq: 1568, at: 0.0, dur: 0.07, gain: 0.08, type: 'triangle' },
  ],
  // DELETE — "record cleared": single low descending blip
  delete: [
    { freq: 740, at: 0.0, dur: 0.09, gain: 0.22, type: 'square' },
  ],
};

/** Map an HTTP method to a chime kind (null = no chime, e.g. GET). */
export function chimeKindForMethod(method: string | undefined): ActionChimeKind | null {
  switch ((method || 'GET').toUpperCase()) {
    case 'POST': return 'submit';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return null;
  }
}

/** Play a chime directly (e.g. for client-only saves). Safe to call unconditionally. */
export function playActionChime(kind: ActionChimeKind): void {
  try {
    if (!actionChimesEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastChime < THROTTLE_MS) return;
    lastChime = now;

    // Sampled transaction-ACK (actual audio asset); synth below is the fallback
    if (playSoundAsset(kind)) return;

    const ac = getCtx();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();

    const master = ac.createGain();
    master.gain.value = 0.5;
    // Lowpass tames square harmonics into the dry console timbre
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2800;
    master.connect(filter);
    filter.connect(ac.destination);

    const t0 = ac.currentTime + 0.01;
    for (const step of SEQUENCES[kind]) {
      const start = t0 + step.at;
      const osc = ac.createOscillator();
      osc.type = step.type;
      osc.frequency.value = step.freq;
      // Delete blip gets a slight downward bend — reads as "removed"
      if (kind === 'delete') osc.frequency.exponentialRampToValueAtTime(step.freq * 0.78, start + step.dur);

      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(step.gain, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, start + step.dur);

      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + step.dur + 0.05);
    }
  } catch {
    // Audio is a nicety — never let it break the save flow
  }
}

/**
 * Chime for a successful mutating API call. Called from the apiFetch /
 * useApi success paths; filters out background machine traffic.
 */
export function chimeForApiSuccess(method: string | undefined, url: string): void {
  const kind = chimeKindForMethod(method);
  if (!kind) return;
  if (BACKGROUND_PATHS.test(url)) return;
  playActionChime(kind);
}
