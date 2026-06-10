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

// click.wav — mechanical key tick: noise transient + pitched flick
{
  const s = make(0.07);
  noiseBurst(s, { at: 0, dur: 0.02, gain: 0.5, lowpass: 5200 });
  tone(s, { at: 0, dur: 0.03, f0: 2100, f1: 1350, gain: 0.55, attack: 0.002, type: 'square' });
  tone(s, { at: 0, dur: 0.018, f0: 4200, f1: 3100, gain: 0.12, attack: 0.001 });
  writeWav(path.join(outDir, 'click.wav'), s);
}

// submit.wav — "entry accepted": two ascending data blips, detuned pair each
{
  const s = make(0.25);
  for (const [at, f] of [[0, 1046], [0.09, 1568]]) {
    tone(s, { at, dur: 0.07, f0: f, gain: 0.5, type: 'square' });
    tone(s, { at, dur: 0.07, f0: f * 1.004, gain: 0.25, type: 'square' }); // detune layer = sampled width
    noiseBurst(s, { at, dur: 0.008, gain: 0.10, lowpass: 6000 });
  }
  writeWav(path.join(outDir, 'submit.wav'), s);
}

// update.wav — "record updated": mid blip + soft confirm a 4th up
{
  const s = make(0.18);
  tone(s, { at: 0, dur: 0.08, f0: 1175, gain: 0.5, type: 'square' });
  tone(s, { at: 0, dur: 0.10, f0: 1568, gain: 0.16, harmonics: 2 });
  noiseBurst(s, { at: 0, dur: 0.008, gain: 0.08, lowpass: 6000 });
  writeWav(path.join(outDir, 'update.wav'), s);
}

// delete.wav — "record cleared": low descending blip with body
{
  const s = make(0.16);
  tone(s, { at: 0, dur: 0.11, f0: 740, f1: 560, gain: 0.5, type: 'square' });
  tone(s, { at: 0, dur: 0.11, f0: 370, f1: 280, gain: 0.18 }); // sub-octave weight
  noiseBurst(s, { at: 0, dur: 0.01, gain: 0.08, lowpass: 3500 });
  writeWav(path.join(outDir, 'delete.wav'), s);
}

// login.wav — sign-on acknowledge: two data blips + firm confirm chord w/ ring-out
{
  const s = make(1.1);
  tone(s, { at: 0.0, dur: 0.07, f0: 1318, gain: 0.42, type: 'square' });
  tone(s, { at: 0.11, dur: 0.07, f0: 1760, gain: 0.42, type: 'square' });
  noiseBurst(s, { at: 0.0, dur: 0.008, gain: 0.08, lowpass: 6000 });
  noiseBurst(s, { at: 0.11, dur: 0.008, gain: 0.08, lowpass: 6000 });
  // confirm: root + fifth, detuned layers, long exponential tail
  for (const [f, g] of [[523, 0.5], [524.5, 0.22], [659, 0.26], [661, 0.12]]) {
    tone(s, { at: 0.26, dur: 0.8, f0: f, gain: g, attack: 0.015, harmonics: 3 });
  }
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
  info:            { type: 'sine', steps: [[1000, 0, 0.05]] },
  caution:         { type: 'sine', steps: [[853, 0, 0.33], [960, 0.35, 0.33]] },
  warning:         { type: 'sine', steps: [[1050, 0, 0.15], [1450, 0.17, 0.15], [1050, 0.34, 0.15], [1450, 0.51, 0.15], [1050, 0.68, 0.15], [1450, 0.85, 0.15]] },
  error:           { type: 'square', steps: [[440, 0, 0.12], [349, 0.15, 0.12]] },
  alert:           { type: 'sine', steps: [[880, 0, 0.08], [1047, 0.11, 0.08], [1319, 0.22, 0.10]] },
  alarm:           { type: 'sine', steps: [[800, 0, 0.09], [1000, 0.10, 0.09], [800, 0.20, 0.09], [1000, 0.30, 0.09], [800, 0.40, 0.09], [1000, 0.50, 0.09], [800, 0.60, 0.09], [1000, 0.70, 0.09]] },
  chirp:           { type: 'sine', steps: [[800, 0, 0.03], [1200, 0.03, 0.03]] },
  double_chirp:    { type: 'sine', steps: [[800, 0, 0.03], [1200, 0.03, 0.03], [800, 0.14, 0.03], [1200, 0.17, 0.03]] },
  descending:      { type: 'sine', steps: [[1047, 0, 0.08], [880, 0.10, 0.08], [698, 0.20, 0.10]] },
  p1_alert:        { type: 'sine', steps: [[1200, 0, 0.10], [800, 0.12, 0.10], [1200, 0.24, 0.10], [800, 0.40, 0.10], [1200, 0.52, 0.10], [800, 0.64, 0.10]] },
  panic_continuous:{ type: 'sine', steps: Array.from({ length: 24 }, (_, i) => [i % 2 ? 1100 : 800, i * 0.10, 0.09]) },
  key_up:          { type: 'sine', steps: [[760, 0, 0.045, 913], [913, 0.045, 0.11]] },
  key_out:         { type: 'sine', steps: [[900, 0, 0.06], [650, 0.07, 0.07]] },
  radio_grant:     { type: 'sine', steps: [[600, 0, 0.08, 1200]] },
  radio_deny:      { type: 'sawtooth', steps: [[310, 0, 0.25]] },
  quick_call_2:    { type: 'sine', steps: [[947, 0, 0.4], [1153, 0.42, 0.4]] },
  talk_permit_low: { type: 'sine', steps: [[560, 0, 0.045, 660], [660, 0.045, 0.12]] },
  call_alert:      { type: 'sine', steps: [[1000, 0, 0.08], [1000, 0.16, 0.08], [1000, 0.32, 0.08], [1000, 0.48, 0.08]] },
  knox_alert:      { type: 'sine', steps: [[1200, 0, 0.07], [900, 0.08, 0.07], [1200, 0.16, 0.07], [900, 0.24, 0.07], [1200, 0.32, 0.07], [900, 0.40, 0.07]] },
  squelch_tail:    { type: 'sine', steps: [['1800n', 0, 0.12]] },
  static_burst:    { type: 'sine', steps: [['1500n', 0, 0.32]] },
  boop:            { type: 'sine', steps: [[480, 0, 0.12]] },
  dispatch_bell:   { type: 'sine', steps: [[1318, 0, 0.16], [988, 0.14, 0.22]] },
  data_chirp:      { type: 'sine', steps: [[1500, 0, 0.05, 2200]] },
  emergency_three: { type: 'sine', steps: [[800, 0, 0.09], [1100, 0.10, 0.09], [800, 0.20, 0.09], [1100, 0.30, 0.09], [800, 0.40, 0.09], [1100, 0.50, 0.09]] },
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
