// ============================================================
// RMPG Flex — Radio Audio FX Chain
//
// DSP processing that gives audio that authentic radio sound:
//   highpass (300Hz) → lowpass (3kHz) → compressor → soft clip → resonance
//
// All nodes are standard Web Audio API — no external libraries.
// Toggleable: when disabled, input connects directly to output.
// ============================================================

export interface RadioFxChain {
  input: GainNode;
  output: GainNode;
  enabled: boolean;

  /** Toggle the FX chain on/off */
  toggle(): void;

  /** Destroy all nodes */
  destroy(): void;
}

/**
 * Generate a soft-clipping waveshaper curve.
 * Uses arctangent transfer function: f(x) = (2/π) * atan(k * x)
 * k controls the drive amount — higher = more distortion.
 */
function makeDistortionCurve(k: number = 2.0, samples: number = 4096): Float32Array {
  const curve = new Float32Array(samples);
  const scale = 2 / Math.PI;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1; // -1 to +1
    curve[i] = scale * Math.atan(k * x);
  }
  return curve;
}

export function createRadioFxChain(ctx: AudioContext): RadioFxChain {
  // ── Input/Output gain nodes (always present) ─────────
  const input = ctx.createGain();
  input.gain.value = 1.0;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  // ── DSP nodes ────────────────────────────────────────

  // 1. Highpass — removes low-frequency rumble below voice range
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 300;
  highpass.Q.value = 0.7;

  // 2. Lowpass — caps the frequency range at voice band ceiling
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3000;
  lowpass.Q.value = 0.7;

  // 3. Compressor — levels out voice dynamics (loud/soft becomes uniform)
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 8;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;

  // 4. Soft clipping — gentle radio distortion/crunch
  const waveshaper = ctx.createWaveShaper();
  waveshaper.curve = makeDistortionCurve(2.0);
  waveshaper.oversample = '2x';

  // 5. Radio speaker resonance — peaking EQ at 1800Hz
  const resonance = ctx.createBiquadFilter();
  resonance.type = 'peaking';
  resonance.frequency.value = 1800;
  resonance.Q.value = 1.5;
  resonance.gain.value = 3;

  // ── Wire the DSP chain ───────────────────────────────
  // input → highpass → lowpass → compressor → waveshaper → resonance → output
  function connectFxChain(): void {
    input.disconnect();
    input.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(waveshaper);
    waveshaper.connect(resonance);
    resonance.connect(output);
  }

  // Bypass: input → output directly
  function bypassFxChain(): void {
    input.disconnect();
    // Disconnect all DSP nodes from each other
    try { highpass.disconnect(); } catch { /* ok */ }
    try { lowpass.disconnect(); } catch { /* ok */ }
    try { compressor.disconnect(); } catch { /* ok */ }
    try { waveshaper.disconnect(); } catch { /* ok */ }
    try { resonance.disconnect(); } catch { /* ok */ }
    input.connect(output);
  }

  let enabled = true;
  connectFxChain();

  return {
    input,
    output,
    enabled,

    toggle(): void {
      enabled = !enabled;
      this.enabled = enabled;
      if (enabled) {
        connectFxChain();
      } else {
        bypassFxChain();
      }
    },

    destroy(): void {
      try {
        input.disconnect();
        highpass.disconnect();
        lowpass.disconnect();
        compressor.disconnect();
        waveshaper.disconnect();
        resonance.disconnect();
        output.disconnect();
      } catch { /* already disconnected */ }
    },
  };
}
