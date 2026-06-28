// ============================================================
// RMPG Flex — Bitcrusher AudioWorklet Processor
//
// 12-bit quantization for IMBE/AMBE codec artifact simulation.
// Reduces bit depth to create the stepped distortion heard on
// P25 / APCO-25 digital radio systems.
//
// Loaded via Blob URL in edgeTTS.ts:
//   audioContext.audioWorklet.addModule(blobUrl)
// ============================================================

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 12, minValue: 1, maxValue: 16 },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.[0]) return true;

    const bits = parameters.bitDepth[0];
    const step = 1 / Math.pow(2, bits);

    for (let ch = 0; ch < input.length; ch++) {
      const inp = input[ch];
      const out = output[ch];
      for (let i = 0; i < inp.length; i++) {
        out[i] = Math.round(inp[i] / step) * step;
      }
    }
    return true;
  }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
