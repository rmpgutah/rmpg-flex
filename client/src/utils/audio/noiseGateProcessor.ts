// ============================================================
// RMPG Flex — Noise Gate AudioWorklet Processor
//
// Closes audio below a dB threshold with configurable attack
// and release envelope. Used in the radio TTS pipeline to
// eliminate low-level noise between speech segments.
//
// Loaded via Blob URL in edgeTTS.ts:
//   audioContext.audioWorklet.addModule(blobUrl)
// ============================================================

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -100, maxValue: 0 },
    ];
  }

  private envelope = 0;
  private readonly attack = 0.01;   // 10ms
  private readonly release = 0.1;   // 100ms

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.[0]) return true;

    const threshold = parameters.threshold[0];

    for (let ch = 0; ch < input.length; ch++) {
      const inp = input[ch];
      const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        const amplitude = Math.abs(inp[i]);
        const db = 20 * Math.log10(amplitude + 1e-10);
        this.envelope = db > threshold
          ? Math.min(1, this.envelope + this.attack)
          : Math.max(0, this.envelope - this.release);
        out[i] = inp[i] * this.envelope;
      }
    }
    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
