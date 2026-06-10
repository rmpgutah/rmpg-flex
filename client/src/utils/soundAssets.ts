// ============================================================
// RMPG Flex — Sound Assets (actual sampled console audio)
// Loads the real WAV files in /sounds/ (rendered by
// scripts/generate-ui-sounds.js — Spillman Flex / Motorola MDT
// console feedback) and plays them as decoded AudioBuffers.
//
// This is the primary voice for clicks / action chimes / login;
// the WebAudio oscillator synth in uiClickSounds.ts /
// actionChimes.ts / startupSound.ts remains the fallback when an
// asset hasn't decoded yet (first ever click), fails to fetch, or
// WebAudio decode is unavailable. Genuine Spillman WAV exports can
// be dropped over the files in client/public/sounds/ — same
// names, no code change needed.
//
// One shared lazy AudioContext; buffers decode once and replay
// with near-zero latency (cheaper than building an oscillator
// graph per event). Gating (audio mode, user toggles, throttles)
// stays in the callers — this module only knows how to play.
// ============================================================

export type SoundAssetKey = 'click' | 'submit' | 'update' | 'delete' | 'login';

const ASSET_GAIN: Record<SoundAssetKey, number> = {
  click: 0.18,
  submit: 0.35,
  update: 0.35,
  delete: 0.35,
  login: 0.5,
};

let ctx: AudioContext | null = null;
const buffers = new Map<SoundAssetKey, AudioBuffer>();
const failed = new Set<SoundAssetKey>();
const loading = new Set<SoundAssetKey>();

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

function load(key: SoundAssetKey): void {
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

/** Warm the decode cache (call once at app boot so the first click is sampled, not synth). */
export function preloadSoundAssets(keys: SoundAssetKey[] = ['click', 'submit', 'update', 'delete', 'login']): void {
  try { keys.forEach(load); } catch { /* audio is a nicety */ }
}

/**
 * Play a sampled asset. Returns true if the sample played; false means
 * the caller should fall back to its synthesized voice.
 */
export function playSoundAsset(key: SoundAssetKey): boolean {
  try {
    const buf = buffers.get(key);
    if (!buf) { load(key); return false; }
    const ac = getCtx();
    if (!ac) return false;
    if (ac.state === 'suspended') void ac.resume();

    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.value = ASSET_GAIN[key];
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
    return true;
  } catch {
    return false;
  }
}
