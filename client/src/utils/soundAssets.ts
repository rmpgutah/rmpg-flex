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
// The WebAudio oscillator synth in uiClickSounds.ts /
// actionChimes.ts / startupSound.ts / dispatchTones.ts remains the
// fallback when an asset hasn't decoded yet, fails to fetch, or
// WebAudio decode is unavailable. Genuine Spillman WAV exports can
// be dropped over the files in client/public/sounds/ — same
// names, no code change needed.
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

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
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
    g.gain.value = gain;
    src.connect(g);
    g.connect(ac.destination);
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
