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

console.log('Done.');
