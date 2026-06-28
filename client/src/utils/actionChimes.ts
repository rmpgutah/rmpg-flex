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
import { playSoundAsset, startSoundAsset } from './soundAssets';

export type ActionChimeKind = 'submit' | 'update' | 'delete';

const TOGGLE_KEY = 'rmpg_action_chimes';
const THROTTLE_MS = 400;

// Mutations that are machine traffic, not operator actions — never chime.
const BACKGROUND_PATHS = /\/(gps|heartbeat|activity|telemetry|live-sync|presence|ping|nav\/trip|trips\/breadcrumb|breadcrumbs|welfare|read-receipts?|seen|ack|token\/refresh|auth\/refresh|logs?\b)/i;

let lastChime = 0;

export function actionChimesEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch { return true; }
}

export function setActionChimesEnabled(on: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

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

    // Sample-only: plays the curated WAV asset; a miss (still decoding /
    // fetch failed) stays silent by design — never substitute the old
    // synthesized blips.
    playSoundAsset(kind);
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

// NACK throttled separately from the ACKs — a failure must still sound
// even if a success chimed an instant earlier.
let lastNack = 0;

/**
 * Spillman console NACK — the error bonk when a transaction is REJECTED.
 * Called from the apiFetch / useApi failure paths for operator-initiated
 * mutations only: GETs stay silent (a failed poll isn't an operator
 * action), background machine traffic stays silent, and 401s stay silent
 * (the transparent token-refresh dance isn't a rejection).
 */
export function nackForApiFailure(method: string | undefined, url: string, status?: number): void {
  try {
    const kind = chimeKindForMethod(method);
    if (!kind) return;
    if (BACKGROUND_PATHS.test(url)) return;
    if (status === 401) return;
    if (!actionChimesEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastNack < THROTTLE_MS) return;
    lastNack = now;
    // error.wav = the sampled console NACK bonk (gain matches the ACKs).
    startSoundAsset('error', 0.22);
  } catch {
    // Audio is a nicety — never let it break error handling
  }
}
