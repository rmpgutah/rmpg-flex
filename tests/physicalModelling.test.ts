// Guards the system-sound invariants against the shipped WAV bytes.
//
// Two things must hold together, and they pull against each other:
//   1. Pitch must stay on the documented Motorola frequency. The physical
//      modelling adds ±0.15% drift; if anyone widens that, the SOURCED
//      provenance claim quietly stops being true.
//   2. Harmonic content must actually be present. A pure sine at the right
//      frequency measures "correct" on pitch while sounding synthetic —
//      which is exactly the state this modelling was added to fix, so a
//      regression to pure tones has to fail loudly rather than silently.
//
// Also pins the -1 dBFS peak contract and the 44.1kHz/16-bit/mono format.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOUNDS = join(__dirname, '..', 'client', 'public', 'sounds');

interface Wav { samples: Float64Array; sampleRate: number; bits: number; channels: number }

function readWav(name: string): Wav {
  const raw = readFileSync(join(SOUNDS, name + '.wav'));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let off = 12, sampleRate = 44100, bits = 16, channels = 1;
  let samples = new Float64Array(0);
  while (off < raw.length - 8) {
    const id = String.fromCharCode(raw[off], raw[off + 1], raw[off + 2], raw[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(off + 10, true);
      sampleRate = dv.getUint32(off + 12, true);
      bits = dv.getUint16(off + 22, true);
    } else if (id === 'data') {
      const n = Math.floor(size / (bits / 8) / channels);
      samples = new Float64Array(n);
      for (let i = 0; i < n; i++) samples[i] = dv.getInt16(off + 8 + i * channels * 2, true) / 32768;
      break;
    }
    off += 8 + size + (size % 2);
  }
  return { samples, sampleRate, bits, channels };
}

/** Goertzel magnitude at one frequency — exact for steady tones, and immune
 *  to the octave/subharmonic errors autocorrelation makes here. */
function goertzel(w: number[], sr: number, f: number): number {
  const k = 2 * Math.cos(2 * Math.PI * f / sr);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < w.length; i++) { const s0 = w[i] + k * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / w.length;
}

/** DC-removed window, 25 ms starting 15% into the file — inside the first tone. */
function window25ms(w: Wav): number[] {
  const start = Math.floor(w.samples.length * 0.15);
  const len = Math.floor(0.025 * w.sampleRate);
  const out = Array.from(w.samples.slice(start, Math.min(start + len, w.samples.length)));
  let mean = 0; for (const v of out) mean += v; mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return out;
}

function dominantFrequency(w: Wav): number {
  const win = window25ms(w);
  let best = -1, bestF = 0;
  for (let f = 250; f <= 2600; f += 1) {
    const m = goertzel(win, w.sampleRate, f);
    if (m > best) { best = m; bestF = f; }
  }
  return bestF;
}

/** Third-harmonic energy relative to the fundamental. */
function thirdHarmonicRatio(w: Wav, f0: number): number {
  const win = window25ms(w);
  return goertzel(win, w.sampleRate, f0 * 3) / goertzel(win, w.sampleRate, f0);
}

// [name, documented first-tone frequency, source]
const SYSTEM_SOUNDS: Array<[string, number, string]> = [
  ['navigate', 1153.4, 'Reed Group 6, tone 1'],
  ['ui_open',   600.9, 'Reed Group 2, tone 2'],
  ['ui_close',  928.1, 'Reed Group 2, tone 9'],
  ['submit',   1200,   'MDC-1200 mark'],
  ['delete',    539.0, 'Reed Group 1, tone 9'],
  ['ui_error',  368.5, 'Reed Group 1, tone 2'],
  ['login',     349.0, 'Reed Group 1, tone 1'],
];

// click is a 600 -> 1200 Hz glide (a P25 channel-grant tone, electronically
// generated), so it has no single steady fundamental and is excluded from the
// pitch assertion. update stacks 1200 + 1800 Hz simultaneously, so the
// dominant-frequency scan reports whichever partial is stronger.
const ALL_SYSTEM = [...SYSTEM_SOUNDS.map(([n]) => n), 'click', 'update'];

describe('system sound format contract', () => {
  it.each(ALL_SYSTEM)('%s is 44.1kHz 16-bit mono', (name) => {
    const w = readWav(name);
    expect(w.sampleRate).toBe(44100);
    expect(w.bits).toBe(16);
    expect(w.channels).toBe(1);
    expect(w.samples.length).toBeGreaterThan(0);
  });

  it.each(ALL_SYSTEM)('%s is normalized to the -1 dBFS peak contract', (name) => {
    const { samples } = readWav(name);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    // writeWav() normalizes to 0.891; 16-bit quantization is the only slack.
    expect(peak).toBeCloseTo(0.891, 2);
  });
});

describe('documented Motorola pitch is preserved', () => {
  it.each(SYSTEM_SOUNDS)(
    '%s measures its documented %d Hz (%s)',
    (name, expected) => {
      const measured = dominantFrequency(readWav(name));
      // ±0.4% or 3 Hz, whichever is larger. The modelling's drift is ±0.15%,
      // so this fails if anyone widens the drift enough to break provenance.
      const tolerance = Math.max(3, expected * 0.004);
      expect(Math.abs(measured - expected)).toBeLessThanOrEqual(tolerance);
    },
  );
});

describe('physical modelling is actually applied', () => {
  it.each(SYSTEM_SOUNDS)(
    '%s carries harmonic content, not a pure sine',
    (name, f0) => {
      const ratio = thirdHarmonicRatio(readWav(name), f0);
      // Pure sines measured 0.0007-0.0197 here; modelled measured 0.055-0.140.
      // 0.03 sits clear of both, so a regression to pure tones fails.
      expect(ratio).toBeGreaterThan(0.03);
    },
  );
});

describe('Motorola library separation', () => {
  it('ui_error is a distinct file from the Motorola error tone', () => {
    // These were one filename with two owners; the dispatch library renders
    // last and silently overwrote the system NACK.
    const sys = readWav('ui_error');
    const motorola = readWav('error');
    expect(sys.samples.length).not.toBe(motorola.samples.length);
  });

  it('ui_close is a distinct file from the Motorola key_out de-key', () => {
    const sys = readWav('ui_close');
    const motorola = readWav('key_out');
    expect(sys.samples.length).not.toBe(motorola.samples.length);
  });
});
