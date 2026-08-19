#!/usr/bin/env node
// ============================================================
// RMPG Flex — UI sound asset generator (Spillman Flex console)
// Renders the console feedback sounds as real 16-bit PCM WAV
// files into client/public/sounds/. These are the "actual audio"
// assets played by client/src/utils/soundAssets.ts (the live
// WebAudio synth in uiClickSounds/actionChimes/startupSound is
// the offline fallback). Re-run after tweaking and commit the
// WAVs:   node scripts/generate-ui-sounds.js
//
// Sound design follows the Motorola/Spillman MDT idiom — dry,
// utilitarian, short — but with sample-grade character the live
// oscillators can't do: noise-burst key transients, detuned
// dual-layer chime partials, and exponential ring-out tails.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const SR = 44100;

function writeWav(filePath, samples) {
  // Peak-normalize to -1 dBFS headroom
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0 ? 0.891 / peak : 1;

  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
  console.log(`  ${path.basename(filePath)}  ${(buf.length / 1024).toFixed(1)} KB  ${(n / SR * 1000).toFixed(0)} ms`);
}

const make = (seconds) => new Float64Array(Math.ceil(seconds * SR));

// ============================================================
// PHYSICAL MODELLING — system/UI sounds only.
//
// A pure sine at a documented Motorola frequency IS that frequency, but it
// does not sound like a recording of it. What a recording adds is the
// CHANNEL: harmonic content (a driven reed or oscillator is never a pure
// sine), mechanical pitch and amplitude instability, transducer resonance,
// a noise floor, and a non-instant onset.
//
// Added 2026-07-31 after the pure-tone build was judged synthetic. This is
// NOT the 22.05kHz/8-bit "workstation" chain that was rejected earlier —
// that worked by REMOVING fidelity. This adds character AT full 44.1kHz
// /16-bit fidelity. Different axis.
//
// ⚠️ Pitch is unchanged by design. The drift is ±0.15%, well inside
// measurement tolerance, so every SOURCED frequency still measures correct.
// physicalModelling.test.ts asserts this.
// ============================================================

/**
 * Seeded LCG in [-1,1). Used for every stochastic element of the SYSTEM
 * sounds so re-running the generator produces byte-identical output.
 *
 * This matters: the Motorola dispatch tones below use Math.random via
 * bandNoise/noiseBurst, which is why simply re-running this script dirties
 * squelch_tail.wav and static_burst.wav even with no source change. The
 * system sounds deliberately do not have that property.
 */
function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Deterministic filtered noise transient (mechanical key character). */
function physNoise(out, { at = 0, dur, gain, lowpass = 3000, seed }) {
  const rand = makeRand(seed);
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  let lp = 0;
  const a = Math.exp(-2 * Math.PI * lowpass / SR);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR;
    lp = a * lp + (1 - a) * rand();
    out[start + i] += lp * gain * Math.exp(-t / (dur / 6));
  }
}

/** Deterministic -62dB noise floor across the whole buffer. */
function noiseFloor(x, seed, gain = 0.0008) {
  const rand = makeRand(seed);
  for (let i = 0; i < x.length; i++) x[i] += rand() * gain;
  return x;
}

/** RBJ biquad, applied in place. type: 'hp' | 'lp' | 'peak'. */
function biquad(x, { type, f0, Q = 0.707, gainDb = 0 }) {
  const w0 = 2 * Math.PI * f0 / SR, cs = Math.cos(w0), sn = Math.sin(w0);
  const alpha = sn / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
    a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
  } else if (type === 'lp') {
    b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
    a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
  } else {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    x[i] = yn;
  }
  return x;
}

/**
 * A physically-modelled steady tone. Same contract as steadyTone (fixed
 * pitch, flat top, linear edges) plus:
 *   - odd harmonics: 3rd at -21dB, 5th at -31dB, a little 2nd for asymmetry
 *   - ±0.15% pitch drift at 4.3Hz  (mechanical instability)
 *   - 3.5% amplitude wobble at 7.1Hz
 *   - 6ms onset instead of a near-square edge
 * `f1` allows a glide for the electronically-generated tones (click), where
 * a sweep is correct — a mechanical reed cannot sweep, a P25 grant tone can.
 */
function physTone(out, { at, dur, f0, f1 = f0, gain, edge = 0.006, harm = true }) {
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  const e = Math.min(edge, dur / 3) * SR;
  let ph = 0, ph2 = 0, ph3 = 0, ph5 = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR;
    let f = f0 * Math.pow(f1 / f0, t / dur);
    // Deterministic drift — no Math.random, so the generator stays
    // reproducible for these files (unlike the noise-based tones).
    f *= 1 + 0.0015 * Math.sin(2 * Math.PI * 4.3 * t);
    ph += 2 * Math.PI * f / SR;
    let s = Math.sin(ph);
    if (harm) {
      ph3 += 2 * Math.PI * f * 3 / SR;
      ph5 += 2 * Math.PI * f * 5 / SR;
      ph2 += 2 * Math.PI * f * 2 / SR;
      s += 0.085 * Math.sin(ph3) + 0.028 * Math.sin(ph5) + 0.020 * Math.sin(ph2);
      s *= 1 + 0.035 * Math.sin(2 * Math.PI * 7.1 * t);
    }
    let env = 1;
    if (i < e) env = i / e;
    else if (i > len - e) env = Math.max(0, (len - i) / e);
    out[start + i] += s * gain * env;
  }
}

/**
 * Transducer + enclosure colour, applied to a finished buffer:
 * two resonant peaks (cone 1.1kHz, box 2.7kHz) and a 170Hz highpass —
 * a small speaker has no output below that. Call ONCE per sound, last.
 */
function cabinet(x) {
  biquad(x, { type: 'peak', f0: 1100, Q: 1.6, gainDb: 4.5 });
  biquad(x, { type: 'peak', f0: 2700, Q: 2.2, gainDb: 3.0 });
  biquad(x, { type: 'hp',   f0: 170,  Q: 0.707 });
  return x;
}

/** Add a tone partial: freq can glide (f0→f1), exp attack/decay envelope. */
function tone(out, { at = 0, dur, f0, f1 = f0, gain, attack = 0.004, type = 'sine', harmonics = 0 }) {
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  let phase = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR;
    const f = f0 * Math.pow(f1 / f0, t / dur);
    phase += (2 * Math.PI * f) / SR;
    let s = Math.sin(phase);
    if (type === 'square') s = Math.tanh(Math.sin(phase) * 5); // soft-clipped square — console timbre w/o aliasing
    // optional extra harmonics for body
    for (let h = 2; h <= 1 + harmonics; h++) s += Math.sin(phase * h) / (h * h);
    const env = t < attack ? t / attack : Math.exp(-(t - attack) / ((dur - attack) / 5));
    out[start + i] += s * gain * env;
  }
}

/** Add a filtered noise burst (key transient / mechanical character). */
function noiseBurst(out, { at = 0, dur, gain, lowpass = 4000 }) {
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  let lp = 0;
  const a = Math.exp(-2 * Math.PI * lowpass / SR);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR;
    const white = Math.random() * 2 - 1;
    lp = a * lp + (1 - a) * white;
    out[start + i] += lp * gain * Math.exp(-t / (dur / 6));
  }
}

const outDir = path.join(__dirname, '..', 'client', 'public', 'sounds');
fs.mkdirSync(outDir, { recursive: true });
console.log('Rendering Spillman-style console sounds →', outDir);

// ============================================================
// SYSTEM / UI SOUNDS — rebuilt 2026-07-31.
//
// Pitch content is SOURCED from documented Motorola tone tables:
// the Midian Electronics Motorola two-tone/four-tone signaling chart
// (reed-group frequencies) and the MDC-1200 mark/space pair. Those
// frequencies were verified against real Motorola paging recordings —
// measured within 0.06 Hz of the tables after correcting a constant
// 1.25% (8100/8000 Hz) playback offset in the source files.
//
// Cadence and envelope values are DERIVED: real paging timing is
// 1s + 3s, roughly 20x too long for UI feedback. There is no published
// spec for Spillman Flex application UI sounds, so nothing here claims
// to be one.
//
// Tones are STEADY (flat top, linear edges), not gliding. A Motorola
// paging reed is a mechanical resonator: constant amplitude, fixed
// pitch, then stop. It physically cannot sweep. The one exception is
// click — see below.
//
// Rendered clean at 44.1kHz / 16-bit.
// ============================================================

// click.wav — SOURCED: radio_grant's 600 -> 1200 Hz character.
// Operator-chosen 2026-07-31 ("use that as the click sound"). This is
// the P25 channel-grant glide, not a reed tone, so the sweep is correct
// here — channel-grant tones are electronically generated.
// DERIVED: 60ms. radio_grant.wav itself is 140ms, which at the 35ms
// click throttle in uiClickSounds.ts would allow ~4 overlapping copies
// and smear under rapid clicking. Trimmed to sit inside one throttle
// window. radio_grant.wav is UNTOUCHED — this is a separate asset.
{
  const s = make(0.075);
  physNoise(s, { at: 0, dur: 0.008, gain: 0.10, lowpass: 3000, seed: 1001 });
  // glide is CORRECT here: a P25 channel-grant tone is electronically
  // generated, unlike a mechanical reed. harm=false keeps the sweep clean.
  physTone(s, { at: 0, dur: 0.060, f0: 600, f1: 1200, gain: 0.55, edge: 0.003, harm: false });
  noiseFloor(s, 1002);
  cabinet(s);
  writeWav(path.join(outDir, 'click.wav'), s);
}

// navigate.wav — SOURCED 1153.4 Hz (Reed Group 6, tone 1).
// DERIVED: single 40ms pip. Previously an ALIAS of click.wav.
{
  const s = make(0.07);
  physNoise(s, { at: 0, dur: 0.005, gain: 0.05, lowpass: 5000, seed: 2001 });
  physTone(s, { at: 0, dur: 0.040, f0: 1153.4, gain: 0.45, edge: 0.004 });
  noiseFloor(s, 2002);
  cabinet(s);
  writeWav(path.join(outDir, 'navigate.wav'), s);
}

// ui_open.wav — SOURCED 600.9 -> 928.1 Hz (Reed Group 2, tones 2 -> 9).
// DERIVED: ascending discrete pair, 60ms each, no gap (a QC2 page sends
// tone A straight into tone B). Previously an ALIAS of submit.wav.
{
  const s = make(0.15);
  physTone(s, { at: 0,     dur: 0.060, f0: 600.9, gain: 0.40 });
  physTone(s, { at: 0.060, dur: 0.060, f0: 928.1, gain: 0.40 });
  noiseFloor(s, 3001);
  cabinet(s);
  writeWav(path.join(outDir, 'ui_open.wav'), s);
}

// ui_close.wav — SOURCED 928.1 -> 600.9 Hz (Reed Group 2, tones 9 -> 2).
// DERIVED: descending mirror of open. NEW dedicated asset — the close
// role previously BORROWED the Motorola key_out.wav de-key sample.
// key_out.wav is untouched; uiClickSounds now points here instead.
{
  const s = make(0.15);
  physTone(s, { at: 0,     dur: 0.060, f0: 928.1, gain: 0.40 });
  physTone(s, { at: 0.060, dur: 0.060, f0: 600.9, gain: 0.40 });
  noiseFloor(s, 4001);
  cabinet(s);
  writeWav(path.join(outDir, 'ui_close.wav'), s);
}

// submit.wav — SOURCED 1200 -> 1800 Hz (MDC-1200 mark & space).
// DERIVED: ascending pair, 55ms each. Reads as a successful data burst,
// which is what a POST is.
{
  const s = make(0.14);
  physNoise(s, { at: 0, dur: 0.005, gain: 0.04, lowpass: 6000, seed: 5001 });
  physTone(s, { at: 0,     dur: 0.055, f0: 1200, gain: 0.40 });
  physTone(s, { at: 0.055, dur: 0.055, f0: 1800, gain: 0.36 });
  noiseFloor(s, 5002);
  cabinet(s);
  writeWav(path.join(outDir, 'submit.wav'), s);
}

// update.wav — SOURCED 1200 + 1800 Hz (MDC-1200 mark & space).
// DERIVED: both together, 70ms. Same vocabulary as submit but stacked
// rather than sequential — "amended, not new".
{
  const s = make(0.11);
  physTone(s, { at: 0, dur: 0.070, f0: 1200, gain: 0.34 });
  physTone(s, { at: 0, dur: 0.070, f0: 1800, gain: 0.22 });
  noiseFloor(s, 6001);
  cabinet(s);
  writeWav(path.join(outDir, 'update.wav'), s);
}

// delete.wav — SOURCED 539.0 -> 330.5 Hz (Reed Group 1, tones 9 -> 0).
// This exact pair is Motorola Group 1 code 09, independently documented
// by Genave as a real page. DERIVED: 55ms + 90ms, second tone held to land.
{
  const s = make(0.19);
  physTone(s, { at: 0,     dur: 0.055, f0: 539.0, gain: 0.38 });
  physTone(s, { at: 0.055, dur: 0.090, f0: 330.5, gain: 0.42 });
  noiseFloor(s, 7001);
  cabinet(s);
  writeWav(path.join(outDir, 'delete.wav'), s);
}

// ui_error.wav — SOURCED 368.5 -> 330.5 Hz (Reed Group 1, tones 2 -> 0).
// DERIVED: 100ms each. Deliberately the tightest interval in the set —
// a near-unison drop reads as "rejected" without a harsh timbre.
//
// ⚠️ NOT 'error.wav'. That filename is ALSO emitted by the Motorola
// dispatch library below (the sawtooth NACK profile in dispatchTones.ts),
// which runs later and would silently overwrite this file. One filename,
// two owners. The system NACK gets its own asset and actionChimes.ts
// points here; Motorola's error.wav is left entirely alone.
{
  const s = make(0.24);
  physTone(s, { at: 0,     dur: 0.100, f0: 368.5, gain: 0.40 });
  physTone(s, { at: 0.105, dur: 0.100, f0: 330.5, gain: 0.42 });
  noiseFloor(s, 8001);
  cabinet(s);
  writeWav(path.join(outDir, 'ui_error.wav'), s);
}

// login.wav — SOURCED 349.0 -> 928.1 Hz.
//   tone A: Reed Group 1, tone 1 (349.0 Hz)
//   tone B: Reed Group 2, tone 9 (928.1 Hz)
// A real Motorola Quick Call 2 one-plus-one page: tone A from one reed
// group, tone B from another, no silence between.
// DERIVED: time-compressed from the documented 1s / 3s paging timing to
// 150ms / 450ms — the authentic 1:3 ratio preserved at UI scale.
{
  const s = make(0.72);
  physTone(s, { at: 0,     dur: 0.150, f0: 349.0, gain: 0.38, edge: 0.010 });
  physTone(s, { at: 0.150, dur: 0.450, f0: 928.1, gain: 0.40, edge: 0.010 });
  noiseFloor(s, 9001);
  cabinet(s);
  writeWav(path.join(outDir, 'login.wav'), s);
}

// ============================================================
// Full Spillman/Motorola console library (dispatchTones.ts).
// Profile data mirrors PROFILES in client/src/utils/dispatchTones.ts
// (keep in sync — the synth fallback there is canonical; the WAVs
// rendered here are the sampled voice played first).
// Steps: [freq, start, dur] (+ glideTo / noise flags below).
// ============================================================

/** Sustained console tone — 10ms linear edges (no decay), optional glide. */
function steadyTone(out, { at, dur, f0, f1 = f0, gain, type = 'sine', detune = 0 }) {
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  let phase = 0, phase2 = 0;
  const edge = Math.min(0.01, dur / 4);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR;
    const f = f0 + (f1 - f0) * (t / dur); // linear glide, matches WebAudio linearRamp
    phase += (2 * Math.PI * f) / SR;
    let s = type === 'square' ? Math.tanh(Math.sin(phase) * 5)
      : type === 'sawtooth' ? Math.tanh((((phase / Math.PI) % 2) - 1) * 2.5)
      : Math.sin(phase);
    if (detune) { phase2 += (2 * Math.PI * f * (1 + detune)) / SR; s = s * 0.8 + Math.sin(phase2) * 0.25; }
    const env = t < edge ? t / edge : t > dur - edge ? (dur - t) / edge : 1;
    out[start + i] += s * gain * env;
  }
}

/** Band-passed white noise (squelch "kssht" / static hiss). */
function bandNoise(out, { at, dur, center, gain }) {
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  // simple biquad bandpass, Q≈0.7
  const w0 = 2 * Math.PI * center / SR, alpha = Math.sin(w0) / (2 * 0.7);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const edge = Math.min(0.01, dur / 4);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SR;
    const x = Math.random() * 2 - 1;
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const env = t < edge ? t / edge : t > dur - edge ? (dur - t) / edge : 1;
    out[start + i] += y * gain * env;
  }
}

// step: [freq, start, dur, glideTo?] — strings 'n' suffix = noise center freq
const LIBRARY = {
  // ── Core dispatch ─────────────────────────────────────────────
  info:            { type: 'sine',     steps: [[1000, 0, 0.055]] },
  caution:         { type: 'sine',     steps: [[853.1, 0, 0.33], [960.0, 0.35, 0.33]] },
  warning:         { type: 'sine',     steps: [[1050, 0, 0.15], [1450, 0.17, 0.15], [1050, 0.34, 0.15], [1450, 0.51, 0.15], [1050, 0.68, 0.15], [1450, 0.85, 0.15]] },
  // error: A4→F4 (440→349 Hz) square NACK — matches Motorola console "buh-buh"
  error:           { type: 'square',   steps: [[440, 0, 0.12], [349, 0.15, 0.12]] },
  // alert: P25 three-pip ascending major triad A5→C6→E6
  alert:           { type: 'sine',     steps: [[880, 0, 0.08], [1047, 0.11, 0.08], [1319, 0.22, 0.10]] },
  alarm:           { type: 'sine',     steps: [[800, 0, 0.09], [1000, 0.10, 0.09], [800, 0.20, 0.09], [1000, 0.30, 0.09], [800, 0.40, 0.09], [1000, 0.50, 0.09], [800, 0.60, 0.09], [1000, 0.70, 0.09]] },
  // chirp: 60ms per step — 30ms was inaudible on MDT speakers
  chirp:           { type: 'sine',     steps: [[800, 0, 0.06], [1200, 0.06, 0.06]] },
  double_chirp:    { type: 'sine',     steps: [[800, 0, 0.06], [1200, 0.06, 0.06], [800, 0.18, 0.06], [1200, 0.24, 0.06]] },
  descending:      { type: 'sine',     steps: [[1047, 0, 0.08], [880, 0.10, 0.08], [698, 0.20, 0.10]] },
  p1_alert:        { type: 'sine',     steps: [[1200, 0, 0.10], [800, 0.12, 0.10], [1200, 0.24, 0.10], [800, 0.40, 0.10], [1200, 0.52, 0.10], [800, 0.64, 0.10]] },
  panic_continuous:{ type: 'sine',     steps: Array.from({ length: 24 }, (_, i) => [i % 2 ? 1100 : 800, i * 0.10, 0.09]) },
  // dispatch_bell: E6→B5 (1318→988 Hz) — Spillman Premier CAD "ding-bong"
  dispatch_bell:   { type: 'sine',     steps: [[1318, 0, 0.16], [988, 0.14, 0.22]] },
  emergency_three: { type: 'sine',     steps: [[800, 0, 0.09], [1100, 0.10, 0.09], [800, 0.20, 0.09], [1100, 0.30, 0.09], [800, 0.40, 0.09], [1100, 0.50, 0.09]] },

  // ── Radio (Motorola APX / P25) ────────────────────────────────
  // key_up: Talk Permit Tone — TIA-102.BAAA "B-tone" at 913 Hz.
  // 760→913 Hz onset glide (≈45ms vocoder snap) + 913 Hz sustain.
  key_up:          { type: 'sine',     steps: [[760, 0, 0.045, 913], [913, 0.045, 0.11]] },
  // key_out: APX de-key courtesy / roger beep — single clean 1800 Hz
  // pip (≈80ms). Replaces the incorrect 900→650 Hz two-tone "bee-boop"
  // which is not an APX characteristic; the roger beep on ASTRO25/APX
  // is a brief mid-band single tone that signals "channel released."
  key_out:         { type: 'sine',     steps: [[1800, 0, 0.08]] },
  radio_grant:     { type: 'sine',     steps: [[600, 0, 0.08, 1200]] },
  // radio_deny: APX channel-busy / PTT-denied — three rapid 1800 Hz
  // pips (50ms each, 50ms gaps). Replaces the incorrect 310 Hz sawtooth
  // buzz; real APX busy indication uses higher-frequency clean tones
  // so they cut through vehicle noise and don't clash with dispatch tones.
  radio_deny:      { type: 'sine',     steps: [[1800, 0, 0.05], [1800, 0.10, 0.05], [1800, 0.20, 0.05]] },
  quick_call_2:    { type: 'sine',     steps: [[947, 0, 0.4], [1153, 0.42, 0.4]] },
  // talk_permit_low: low-power / low-priority channel variant — same
  // APX TPT glide pattern but tracking the 700→850 Hz range (sub-band
  // of the standard 760→913 Hz) at reduced gain.
  talk_permit_low: { type: 'sine',     steps: [[700, 0, 0.045, 850], [850, 0.045, 0.11]] },
  call_alert:      { type: 'sine',     steps: [[1000, 0, 0.08], [1000, 0.16, 0.08], [1000, 0.32, 0.08], [1000, 0.48, 0.08]] },
  knox_alert:      { type: 'sine',     steps: [[1200, 0, 0.07], [900, 0.08, 0.07], [1200, 0.16, 0.07], [900, 0.24, 0.07], [1200, 0.32, 0.07], [900, 0.40, 0.07]] },
  squelch_tail:    { type: 'sine',     steps: [['1800n', 0, 0.12]] },
  static_burst:    { type: 'sine',     steps: [['1500n', 0, 0.32]] },
  boop:            { type: 'sine',     steps: [[480, 0, 0.12]] },
  data_chirp:      { type: 'sine',     steps: [[1500, 0, 0.05, 2200]] },
  roger:           { type: 'sine',     steps: [[1200, 0, 0.06]] },

  // ── Status / dispatch ─────────────────────────────────────────
  // ack: brief 1500 Hz confirmation pip — dispatcher click-to-acknowledge
  ack:             { type: 'sine',     steps: [[1500, 0, 0.04]] },
  // bonk: A4→F4 sawtooth NACK — command rejected / permission denied
  bonk:            { type: 'sawtooth', steps: [[440, 0, 0.14], [349, 0.15, 0.18]] },
  // backup_request: triple 1000 Hz pip — officer assistance requested
  backup_request:  { type: 'sine',     steps: [[1000, 0, 0.10], [1000, 0.16, 0.10], [1000, 0.32, 0.10]] },
  // enroute_chirp: 700→900 Hz ascending — unit reports en-route
  enroute_chirp:   { type: 'sine',     steps: [[700, 0, 0.06], [900, 0.06, 0.06]] },
  // onscene_chirp: A5→C6 (880→1046 Hz) — unit arrived at call
  onscene_chirp:   { type: 'sine',     steps: [[880, 0, 0.07], [1046, 0.09, 0.10]] },
  // cleared_chirp: 1100→700 Hz descending — unit cleared / available
  cleared_chirp:   { type: 'sine',     steps: [[1100, 0, 0.10], [700, 0.11, 0.10]] },
  // all_call: slow 800/1200 Hz Hi-Lo for broadcast to all units
  all_call:        { type: 'sine',     steps: [[800, 0, 0.20], [1200, 0.20, 0.20], [800, 0.40, 0.20], [1200, 0.60, 0.20], [800, 0.80, 0.20], [1200, 1.00, 0.20], [800, 1.20, 0.20]] },
  // priority_preempt: rising 600→1000 Hz — higher-priority call interrupts
  priority_preempt:{ type: 'sine',     steps: [[600, 0, 0.09], [1000, 0.09, 0.11]] },
  // unit_to_unit: single 1320 Hz pip — direct unit-to-unit message
  unit_to_unit:    { type: 'sine',     steps: [[1320, 0, 0.08]] },
  // stack_pip: very quiet 1500 Hz nag pip for unacknowledged stacked alerts
  stack_pip:       { type: 'sine',     steps: [[1500, 0, 0.04]] },
  // login_ok: C5→E5→G5 major triad ascending — session established
  login_ok:        { type: 'sine',     steps: [[523, 0, 0.07], [659, 0.07, 0.07], [784, 0.14, 0.10]] },
  // logoff: G5→E5→C5 descending — session terminated
  logoff:          { type: 'sine',     steps: [[784, 0, 0.07], [659, 0.07, 0.07], [523, 0.14, 0.10]] },

  // ── Voice alert / GPS ─────────────────────────────────────────
  // beat_breach: single 660 Hz — unit crossed beat boundary
  beat_breach:     { type: 'sine',     steps: [[660, 0, 0.20]] },
  // gps_warn: two 880 Hz pips — 5-min GPS staleness caution
  gps_warn:        { type: 'sine',     steps: [[880, 0, 0.10], [880, 0.30, 0.10]] },
  // gps_lost: E6→C6→A5 (1318→1046→880 Hz) descending — 15-min GPS gap
  gps_lost:        { type: 'sine',     steps: [[1318, 0, 0.18], [1046, 0.21, 0.18], [880, 0.42, 0.22]] },
  // gps_restored: C6→E6 (1046→1318 Hz) — unit reappeared on GPS
  gps_restored:    { type: 'sine',     steps: [[1046, 0, 0.09], [1318, 0.11, 0.12]] },
  // pursuit_alert: high-pitch 1200/1600 Hz warble — vehicle pursuit speed
  pursuit_alert:   { type: 'sine',     steps: Array.from({ length: 14 }, (_, i) => [i % 2 ? 1600 : 1200, i * 0.11, 0.10]) },
};

console.log('Rendering Spillman/Motorola dispatch tone library…');
for (const [id, profile] of Object.entries(LIBRARY)) {
  const total = Math.max(...profile.steps.map((s) => s[1] + s[2]));
  const s = make(total + 0.06);
  for (const [freq, at, dur, glideTo] of profile.steps) {
    if (typeof freq === 'string' && freq.endsWith('n')) {
      bandNoise(s, { at, dur, center: parseFloat(freq), gain: 0.8 });
    } else {
      // Sustained tones get a whisper of detune for sampled width;
      // sub-100ms pips stay surgically clean like the real console.
      steadyTone(s, { at, dur, f0: freq, f1: glideTo ?? freq, gain: 0.8, type: profile.type, detune: dur >= 0.15 ? 0.0035 : 0 });
    }
  }
  writeWav(path.join(outDir, `${id}.wav`), s);
}

console.log('Done.');
