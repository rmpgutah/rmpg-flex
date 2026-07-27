import { describe, it, expect } from 'vitest';
import { estimateNeurons, estimatePacketNeurons, MODEL_NEURON_RATES } from '../src/utils/serveIntakeNeurons';

const LEGACY_70B = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

describe('estimateNeurons', () => {
  it('computes cost from the published per-million rates', () => {
    // Scout: 24,545/M in, 77,273/M out. 8000 in + 1500 out.
    const n = estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', 8000, 1500);
    expect(n).toBeGreaterThan(280);
    expect(n).toBeLessThan(340);
  });

  it('shows the legacy 70B costing more for the same packet', () => {
    const scout = estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', 8000, 1500);
    const legacy = estimateNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 8000, 1500);
    expect(legacy).toBeGreaterThan(scout);
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(estimateNeurons('@cf/unknown/model', 1000, 100)).toBe(0);
  });

  it('publishes rates for every model the pipeline can select', () => {
    for (const m of [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/moondream/moondream3.1-9B-A2B',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
    ]) {
      expect(MODEL_NEURON_RATES[m]).toBeDefined();
    }
  });
});

describe('estimatePacketNeurons', () => {
  it('counts a doc whose extraction call actually ran', () => {
    const total = estimatePacketNeurons([
      { model: LEGACY_70B, textLength: 2000, modelCalled: true, isVision: false },
    ]);
    expect(total).toBeGreaterThan(0);
  });

  // Finding 1 (phantom-cost bug): documents that never invoked the model —
  // unsupported file type, a file read/store error, or "insufficient text
  // to extract" — still carried the default extraction model on their
  // emptyExtraction() stand-in. A route that gated on modelCalled === false
  // being absent (i.e. inferred "did the model run" from an ocrEngine
  // string check instead of a positive fact) would price these at ~105
  // phantom neurons each. This must be exactly 0.
  it('contributes ZERO neurons for a doc that never reached the model', () => {
    const total = estimatePacketNeurons([
      { model: LEGACY_70B, textLength: 0, modelCalled: false, isVision: false },
    ]);
    expect(total).toBe(0);
  });

  it('a skipped doc does not inflate a packet total next to a real call', () => {
    const realOnly = estimatePacketNeurons([
      { model: LEGACY_70B, textLength: 2000, modelCalled: true, isVision: false },
    ]);
    const realPlusSkipped = estimatePacketNeurons([
      { model: LEGACY_70B, textLength: 2000, modelCalled: true, isVision: false },
      { model: LEGACY_70B, textLength: 0, modelCalled: false, isVision: false },
      { model: LEGACY_70B, textLength: 0, modelCalled: false, isVision: false },
    ]);
    expect(realPlusSkipped).toBe(realOnly);
  });

  it('excludes vision docs from the estimate even if modelCalled is true', () => {
    const total = estimatePacketNeurons([
      { model: '@cf/meta/llama-3.2-11b-vision-instruct', textLength: 5000, modelCalled: true, isVision: true },
    ]);
    expect(total).toBe(0);
  });

  it('sums multiple real calls', () => {
    const one = estimatePacketNeurons([
      { model: LEGACY_70B, textLength: 4000, modelCalled: true, isVision: false },
    ]);
    const two = estimatePacketNeurons([
      { model: LEGACY_70B, textLength: 4000, modelCalled: true, isVision: false },
      { model: LEGACY_70B, textLength: 4000, modelCalled: true, isVision: false },
    ]);
    expect(two).toBe(one * 2);
  });
});
