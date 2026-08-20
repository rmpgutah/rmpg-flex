// ============================================================
// RMPG Flex — Sound Assets (actual sampled console audio)
// Loads the real WAV files in /sounds/ (rendered by
// scripts/generate-ui-sounds.js — Spillman Flex / Motorola MDT
// console feedback + the full dispatch tone library) and plays
// them as decoded AudioBuffers.
//
// This is the primary voice for every console sound: UI clicks,
// action chimes, login sign-on, and all 26 dispatch library tones
// (chirps, warbles, Quick Call II pages, P25 pips, panic alarms).
//
// FALLBACK BEHAVIOUR IS NOT UNIFORM — do not assume a synth safety net:
//  • dispatchTones.ts / startupSound.ts DO fall back to their WebAudio
//    oscillator voice on a decode miss.
//  • uiClickSounds.ts is SAMPLE-ONLY BY DESIGN (see its header): a miss
//    plays silence, because the synthesized tick was harsher than the
//    tuned sample. So any system sound it plays must be in the boot
//    preload list in main.tsx or it is silently silent on first use.
//
// Genuine Spillman WAV exports can be dropped over the files in
// client/public/sounds/ — same names, no code change needed.
//
// One shared lazy AudioContext; buffers decode once and replay
// with near-zero latency (cheaper than building an oscillator
// graph per event). Gating (audio mode, user toggles, throttles)
// stays in the callers — this module only knows how to play.
// ============================================================

/** UI feedback sounds (always preloaded — they fire constantly). */
export type UiSoundKey = 'click' | 'submit' | 'update' | 'delete' | 'login';

// Deliberately quiet — UI feedback should sit under the dispatch tones,
// felt more than heard. Clicks especially fire on every interaction.
const UI_GAIN: Record<UiSoundKey, number> = {
  click: 0.07,
  submit: 0.3,
  update: 0.3,
  delete: 0.3,
  login: 0.28,
};

export interface SoundHandle { stop: () => void }

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
const failed = new Set<string>();
const loading = new Set<string>();

// Hearing-safety ceiling: no sample may ever play above this gain,
// regardless of what a caller (or a bad localStorage remap) requests.
// WAVs are peak-normalized to -1 dBFS, so gain is the absolute level.
const MAX_GAIN = 0.5;

let limiter: DynamicsCompressorNode | null = null;

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  limiter = null;
  return ctx;
}

/** Shared output limiter — clamps transient spikes (overlapping plays,
 *  loud assets dropped in by hand) so the output can never slam. */
function getOutput(ac: AudioContext): AudioNode {
  if (limiter) return limiter;
  try {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; // start taming well below full scale
    comp.knee.value = 12;
    comp.ratio.value = 12;      // limiter-like
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    comp.connect(ac.destination);
    limiter = comp;
    return comp;
  } catch {
    return ac.destination; // ancient WebAudio — play unlimited rather than not at all
  }
}

function load(key: string): void {
  if (buffers.has(key) || failed.has(key) || loading.has(key)) return;
  const ac = getCtx();
  if (!ac) { failed.add(key); return; }
  loading.add(key);
  fetch(`/sounds/${key}.wav`)
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then((ab) => ac.decodeAudioData(ab))
    .then((buf) => { buffers.set(key, buf); })
    .catch(() => { failed.add(key); })
    .finally(() => { loading.delete(key); });
}

/** Warm the decode cache (call once at app boot so the first play is sampled, not synth). */
export function preloadSoundAssets(keys: string[] = ['click', 'submit', 'update', 'delete', 'login']): void {
  try { keys.forEach(load); } catch { /* audio is a nicety */ }
}

/**
 * Preload the critical dispatch tones most likely to fire before the lazy
 * decode cache warms up — new-call chime, panic, P1, alert, and status
 * chirps. Called once from the dispatch UI mount so the first tone is
 * always the WAV, not the synthesizer fallback.
 */
export function preloadDispatchTones(): void {
  const critical = [
    'dispatch_bell', 'caution', 'alert', 'alarm', 'panic_continuous',
    'p1_alert', 'warning', 'emergency_three',
    'chirp', 'double_chirp', 'enroute_chirp', 'onscene_chirp', 'cleared_chirp',
    'info', 'error', 'login_ok', 'logoff',
  ];
  try { critical.forEach(load); } catch { /* audio is a nicety */ }
}

/**
 * Start a sampled asset at the given gain. Returns a stop handle, or
 * null when the caller should fall back to its synthesized voice
 * (asset not yet decoded, fetch failed, WebAudio unavailable).
 */
export function startSoundAsset(key: string, gain: number): SoundHandle | null {
  try {
    const buf = buffers.get(key);
    if (!buf) { load(key); return null; }
    const ac = getCtx();
    if (!ac) return null;
    if (ac.state === 'suspended') void ac.resume();

    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.value = Math.min(Math.max(gain, 0), MAX_GAIN);
    src.connect(g);
    g.connect(getOutput(ac));
    src.start();
    return {
      stop: () => {
        try { g.gain.setValueAtTime(0, ac.currentTime); src.stop(); } catch { /* already stopped */ }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Play a UI feedback sample (fire-and-forget). Returns true if the
 * sample played; false means the caller should fall back to synth.
 */
export function playSoundAsset(key: UiSoundKey): boolean {
  return startSoundAsset(key, UI_GAIN[key]) !== null;
}
