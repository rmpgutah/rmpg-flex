// ============================================================
// RMPG Flex — Centralized Radio Audio Bus
//
// Singleton audio routing graph that ALL radio audio flows through:
//   Source(s) → fxChain (toggleable) → masterGain → analyser → destination
//
// Provides: master volume, mute, per-channel volume, VU metering,
// and a single AudioContext shared by radioTones.ts, StreamPlayer.ts,
// and createRadioStatic().
//
// Volume/mute state persists to localStorage.
// ============================================================

import { createRadioFxChain, type RadioFxChain } from './radioFxChain';

// ─── Audio Bus Interface ───────────────────────────────────

export interface RadioAudioBus {
  ctx: AudioContext;
  masterGain: GainNode;
  analyser: AnalyserNode;
  fxChain: RadioFxChain;
  isMuted: boolean;

  /** The node all audio sources should connect to */
  getInputNode(): AudioNode;

  /** Set master volume (0-1). Persists to localStorage. */
  setMasterVolume(v: number): void;

  /** Get current master volume (0-1) */
  getMasterVolume(): number;

  /** Toggle mute on/off. Returns new muted state. */
  toggleMute(): boolean;

  /** Set mute state explicitly */
  setMuted(muted: boolean): void;

  /** Toggle FX chain on/off. Returns new enabled state. */
  toggleFx(): boolean;

  /** Whether FX chain is enabled */
  isFxEnabled(): boolean;

  /** Get analyser frequency data for VU meter rendering */
  getAnalyserData(): Uint8Array;

  /** Get the analyser node directly (for components that need it) */
  getAnalyser(): AnalyserNode;
}

// ─── localStorage Keys ─────────────────────────────────────

const LS_MASTER_VOLUME = 'rmpg-radio-master-volume';
const LS_MUTED = 'rmpg-radio-muted';
const LS_FX_ENABLED = 'rmpg-radio-fx';

function readFloat(key: string, fallback: number): number {
  const val = localStorage.getItem(key);
  if (val === null) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function readBool(key: string, fallback: boolean): boolean {
  const val = localStorage.getItem(key);
  if (val === null) return fallback;
  return val === 'true';
}

// ─── Singleton ─────────────────────────────────────────────

let _bus: RadioAudioBus | null = null;

/**
 * Get (or create) the shared radio audio bus.
 * First call lazy-inits the AudioContext and full routing graph.
 */
export function getRadioAudioBus(): RadioAudioBus {
  if (_bus && _bus.ctx.state !== 'closed') return _bus;

  const ctx = new AudioContext();

  // Resume if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  // ── Build the routing graph ──────────────────────────

  // FX chain (toggleable DSP processing)
  const fxChain = createRadioFxChain(ctx);

  // Master gain — controls overall radio volume
  const masterGain = ctx.createGain();
  const savedVolume = readFloat(LS_MASTER_VOLUME, 0.7);
  const savedMuted = readBool(LS_MUTED, false);
  masterGain.gain.value = savedMuted ? 0 : savedVolume;

  // Analyser for VU meter
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  // Wire: fxChain.output → masterGain → analyser → destination
  fxChain.output.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  // Set initial FX enabled state from localStorage
  const savedFxEnabled = readBool(LS_FX_ENABLED, true);
  if (!savedFxEnabled && fxChain.enabled) {
    fxChain.toggle();
  }

  // VU data buffer (reused to avoid allocations)
  const vuData = new Uint8Array(analyser.frequencyBinCount);

  // Track mute state (we need to remember the volume when muting)
  let _isMuted = savedMuted;
  let _currentVolume = savedVolume;

  _bus = {
    ctx,
    masterGain,
    analyser,
    fxChain,
    isMuted: _isMuted,

    getInputNode(): AudioNode {
      // All sources connect to the FX chain input
      return fxChain.input;
    },

    setMasterVolume(v: number): void {
      _currentVolume = Math.max(0, Math.min(1, v));
      localStorage.setItem(LS_MASTER_VOLUME, _currentVolume.toString());
      if (!_isMuted) {
        masterGain.gain.setValueAtTime(_currentVolume, ctx.currentTime);
      }
    },

    getMasterVolume(): number {
      return _currentVolume;
    },

    toggleMute(): boolean {
      _isMuted = !_isMuted;
      this.isMuted = _isMuted;
      localStorage.setItem(LS_MUTED, _isMuted.toString());
      if (_isMuted) {
        masterGain.gain.setValueAtTime(0, ctx.currentTime);
      } else {
        masterGain.gain.setValueAtTime(_currentVolume, ctx.currentTime);
      }
      return _isMuted;
    },

    setMuted(muted: boolean): void {
      _isMuted = muted;
      this.isMuted = _isMuted;
      localStorage.setItem(LS_MUTED, _isMuted.toString());
      if (_isMuted) {
        masterGain.gain.setValueAtTime(0, ctx.currentTime);
      } else {
        masterGain.gain.setValueAtTime(_currentVolume, ctx.currentTime);
      }
    },

    toggleFx(): boolean {
      fxChain.toggle();
      localStorage.setItem(LS_FX_ENABLED, fxChain.enabled.toString());
      return fxChain.enabled;
    },

    isFxEnabled(): boolean {
      return fxChain.enabled;
    },

    getAnalyserData(): Uint8Array {
      analyser.getByteFrequencyData(vuData);
      return vuData;
    },

    getAnalyser(): AnalyserNode {
      return analyser;
    },
  };

  return _bus;
}

/**
 * Get the shared AudioContext from the radio audio bus.
 * This replaces the per-module lazy AudioContext creation.
 */
export function getRadioAudioContext(): AudioContext {
  const bus = getRadioAudioBus();
  if (bus.ctx.state === 'suspended') {
    bus.ctx.resume().catch(() => {});
  }
  return bus.ctx;
}
